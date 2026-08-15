import { getSessionUser } from '../_auth.js';
import {
  MAX_PHOTOS, isUrlish, validateHours, validateContact,
  validateParking, validateSignature, validateSimpleFields,
} from '../_venue-validation.js';

// PATCH /api/venues/:id — venue owner self-edit (see migrations/006_owners.sql
// for the ownership table this checks against). Step 2 of the venue owner
// dashboard: entry point + edit form + this save endpoint. New photos never
// arrive in this request body as raw uploads — the client uploads directly
// to Cloudinary (see functions/api/upload-signature.js) and only PATCHes the
// resulting "<version>/<publicId>" in, which validatePhotos() below checks
// actually belongs to this venue's own upload folder.
//
// The field whitelist here is the only thing that matters for safety: the
// client's request body is never trusted past this list, no matter what a
// future UI sends. In particular lat/lng/id/verified/source/status/pin_status
// are permanently excluded — owners never move their own pin (server-side
// GPS validation depends on lat/lng being trustworthy, and a pending venue's
// pin_status only flips to 'placed' by Kar setting real coordinates by
// hand, see functions/api/pending.js), and checkin_radius_m isn't in this
// whitelist either, on purpose: it's the check-in geofence, same trust tier
// as lat/lng, and letting an owner widen it would defeat the anti-farming
// design check-ins already rely on.
//
// Field validation (validateHours/validateContact/etc.) lives in
// ../_venue-validation.js, shared with the POST-create path in
// functions/api/venues.js — same rules apply whether an owner is submitting
// a brand-new venue or editing one that already exists.

function validateLinksAndMaps(body, currentLinks, errors) {
  const links = { ...currentLinks };
  if ('links' in body) {
    const l = body.links;
    if (typeof l !== 'object' || l === null || Array.isArray(l)) {
      errors.links = 'invalid links';
    } else {
      for (const key of ['facebook', 'website']) {
        if (!(key in l)) continue;
        const v = typeof l[key] === 'string' ? l[key].trim() : '';
        if (!isUrlish(v)) { errors.links = `${key} doesn't look like a link`; break; }
        links[key] = v;
      }
    }
  }
  let mapsChanged = false;
  if ('maps_url' in body) {
    const v = typeof body.maps_url === 'string' ? body.maps_url.trim() : '';
    if (!isUrlish(v)) {
      errors.maps_url = "doesn't look like a link";
    } else if (v !== (currentLinks.maps || '')) {
      links.maps = v;
      mapsChanged = true;
    }
  }
  return { links, mapsChanged };
}

// a stored photo value — "<version>/<publicId>", see cloudinaryUrl() in
// js/app.js, not a full URL — counts as "owned" if its publicId lives in
// this venue's own Cloudinary folder (see functions/api/upload-signature.js,
// which signs uploads scoped to exactly this folder) — a client can't forge
// one of these without a valid signature from that endpoint, since the
// folder is baked into the signed params there. cloudName isn't part of the
// stored value anymore, but an empty one still means Cloudinary isn't
// configured, so every photo fails closed rather than open.
function isOwnedPublicId(stored, cloudName, venueId) {
  if (typeof stored !== 'string' || !cloudName) return false;
  const escapedId = venueId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^v\\d+/paisaidee/venues/${escapedId}/[A-Za-z0-9_-]+$`);
  return re.test(stored);
}

// reorder/remove any existing photo freely; a *new* value (not already in
// the venue's photos) is only accepted if it points into this venue's own
// Cloudinary upload folder, which only a signed upload from
// upload-signature.js could have produced. This is a value-level check, not
// just a field-presence whitelist: the field name being writable doesn't
// mean any string is acceptable in it.
function validatePhotos(photos, currentPhotos, venueId, cloudName, errors) {
  if (!Array.isArray(photos)) {
    errors.photos = 'invalid photos';
    return undefined;
  }
  if (photos.length > MAX_PHOTOS) {
    errors.photos = `up to ${MAX_PHOTOS} photos per venue`;
    return undefined;
  }
  const currentSet = new Set(currentPhotos);
  for (const p of photos) {
    if (typeof p !== 'string') { errors.photos = 'invalid photos'; return undefined; }
    if (currentSet.has(p)) continue;
    if (!isOwnedPublicId(p, cloudName, venueId)) {
      errors.photos = 'that photo was not uploaded for this venue';
      return undefined;
    }
  }
  return photos;
}

export async function onRequest(context) {
  if (context.request.method !== 'PATCH') {
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405 });
  }

  try {
    const user = await getSessionUser(context);
    if (!user) return Response.json({ ok: false, need_auth: true }, { status: 401 });

    const venueId = context.params.id;
    const db = context.env.DB;

    const owns = await db.prepare(
      'SELECT 1 FROM venue_owners WHERE user_id = ? AND venue_id = ?'
    ).bind(user.id, venueId).first();
    if (!owns) return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });

    const current = await db.prepare(
      'SELECT photos, links, pin_status FROM venues WHERE id = ?'
    ).bind(venueId).first();
    if (!current) return Response.json({ ok: false, error: 'not found' }, { status: 404 });

    const body = await context.request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return Response.json({ ok: false, error: 'invalid body' }, { status: 400 });
    }

    // validate everything up front and collect every error together — an
    // owner fixing one typo shouldn't have to resubmit to discover the next
    const errors = {};
    const sets = [];
    const binds = [];

    validateSimpleFields(body, errors, sets, binds);

    if ('hours' in body) {
      const hours = validateHours(body.hours, errors);
      if (hours !== undefined) { sets.push('hours = ?'); binds.push(hours ? JSON.stringify(hours) : null); }
    }

    if ('contact' in body) {
      const contact = validateContact(body.contact, errors);
      if (contact !== undefined) { sets.push('contact = ?'); binds.push(contact ? JSON.stringify(contact) : null); }
    }

    if ('parking' in body) {
      const parking = validateParking(body.parking, errors);
      if (parking !== undefined) { sets.push('parking = ?'); binds.push(parking ? JSON.stringify(parking) : null); }
    }

    const currentLinks = current.links ? JSON.parse(current.links) : {};
    let locationReview = false;
    if ('links' in body || 'maps_url' in body) {
      const { links, mapsChanged } = validateLinksAndMaps(body, currentLinks, errors);
      if (!errors.links && !errors.maps_url) {
        sets.push('links = ?');
        binds.push(JSON.stringify(links));
        if (mapsChanged) {
          locationReview = true;
          sets.push('location_review = ?');
          binds.push(1);
        }
      }
    }

    if ('photos' in body) {
      const currentPhotos = JSON.parse(current.photos || '[]');
      const photos = validatePhotos(body.photos, currentPhotos, venueId, context.env.CLOUDINARY_CLOUD_NAME, errors);
      if (photos !== undefined) { sets.push('photos = ?'); binds.push(JSON.stringify(photos)); }
    }

    if ('signature' in body) {
      const signature = validateSignature(body.signature, errors);
      if (signature !== undefined) { sets.push('signature = ?'); binds.push(signature ? JSON.stringify(signature) : null); }
    }

    if (Object.keys(errors).length > 0) {
      return Response.json({ ok: false, errors }, { status: 400 });
    }
    if (sets.length === 0) {
      return Response.json({ ok: false, error: 'nothing to update' }, { status: 400 });
    }

    // an edit to a rejected submission is the owner acting on Kar's
    // feedback (see the ed-rejected-note banner in js/app.js
    // openVenueEditor()) — send it back into the review queue rather than
    // leaving it stuck on 'rejected' forever with no way back
    if (current.pin_status === 'rejected') {
      sets.push('pin_status = ?', 'rejection_reason = ?');
      binds.push('pending', null);
    }

    sets.push('updated_at = ?');
    binds.push(new Date().toISOString());
    binds.push(venueId);

    await db.prepare(`UPDATE venues SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

    // purge the public list's cached entry so the map reflects this edit
    // immediately rather than waiting out its 5-minute TTL — see
    // functions/api/venues.js for the cache this mirrors the key of
    const publicVenuesUrl = new URL('/api/venues', context.request.url).toString();
    await caches.default.delete(new Request(publicVenuesUrl, { method: 'GET' }));

    const updated = await db.prepare(
      `SELECT id, name, short_name, name_lo, type, lat, lng, area, short,
              description, photos, hours, hours_note, contact, parking, links,
              verified, status, source, signature, pin_status
       FROM venues WHERE id = ?`
    ).bind(venueId).first();

    const venue = {
      id: updated.id,
      name: updated.name,
      short_name: updated.short_name,
      name_lo: updated.name_lo,
      type: updated.type,
      lat: updated.lat,
      lng: updated.lng,
      area: updated.area,
      short: updated.short,
      description: updated.description,
      photos: JSON.parse(updated.photos || '[]'),
      hours: updated.hours ? JSON.parse(updated.hours) : null,
      hours_note: updated.hours_note,
      links: updated.links ? JSON.parse(updated.links) : {},
      verified: !!updated.verified,
      source: updated.source,
      pin_status: updated.pin_status,
    };
    if (updated.contact !== null) venue.contact = JSON.parse(updated.contact);
    if (updated.parking !== null) venue.parking = JSON.parse(updated.parking);
    if (updated.status !== null) venue.status = updated.status;
    if (updated.signature !== null) venue.signature = JSON.parse(updated.signature);

    return Response.json({ ok: true, venue, location_review: locationReview });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: 'update failed' }, { status: 500 });
  }
}
