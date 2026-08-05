import { getSessionUser } from '../_auth.js';

// PATCH /api/venues/:id — venue owner self-edit (see migrations/006_owners.sql
// for the ownership table this checks against). Step 2 of the venue owner
// dashboard: entry point + edit form + this save endpoint. Image upload is
// explicitly out of scope this pass — photos can be reordered/removed but
// never added (see PHOTO_FIELD handling below).
//
// The field whitelist here is the only thing that matters for safety: the
// client's request body is never trusted past this list, no matter what a
// future UI sends. In particular lat/lng/id/verified/source/status are
// permanently excluded — owners never move their own pin (server-side GPS
// validation depends on lat/lng being trustworthy), and checkin_radius_m
// isn't in this whitelist either, on purpose: it's the check-in geofence,
// same trust tier as lat/lng, and letting an owner widen it would defeat
// the anti-farming design check-ins already rely on.
const SIMPLE_FIELDS = ['name', 'short_name', 'name_lo', 'type', 'area', 'short', 'description'];
const VENUE_TYPES = ['bar', 'cafe', 'venue'];
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const MAX_LEN = { name: 100, short_name: 40, name_lo: 60, area: 80, short: 120, description: 500 };
const MAX_PARKING_NOTE = 60;

function isUrlish(s) {
  return s === '' || /^https?:\/\/\S+$/i.test(s);
}

// "HH:MM-HH:MM", close hour may run up to 27 to express past-midnight
// closing (see data/venues.json's _schema_notes) — close must be strictly
// after open once both are read as plain minutes-since-midnight
function validHourRange(str) {
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(str);
  if (!m) return false;
  const [, oh, om, ch, cm] = m.map(Number);
  if (oh > 23 || om > 59 || ch > 27 || cm > 59) return false;
  const openMins = oh * 60 + om;
  const closeMins = ch * 60 + cm;
  return closeMins > openMins;
}

function validateHours(hours, errors) {
  if (hours === null) return null;
  if (typeof hours !== 'object' || Array.isArray(hours)) {
    errors.hours = 'invalid hours';
    return undefined;
  }
  const out = {};
  for (const day of DAYS) {
    const v = hours[day];
    if (v === null || v === undefined) { out[day] = null; continue; }
    if (typeof v !== 'string' || !validHourRange(v)) {
      errors.hours = `${day}: expected "HH:MM-HH:MM" or null`;
      return undefined;
    }
    out[day] = v;
  }
  return out;
}

function validateContact(contact, errors) {
  if (contact === null) return null;
  if (typeof contact !== 'object' || Array.isArray(contact)) {
    errors.contact = 'invalid contact';
    return undefined;
  }
  const phone = typeof contact.phone === 'string' ? contact.phone.trim() : '';
  const phone_display = typeof contact.phone_display === 'string' ? contact.phone_display.trim() : '';
  if (!phone) return null; // clearing the phone clears the whole contact block
  if (!/^\+856\d{6,10}$/.test(phone)) {
    errors.contact = 'phone should derive to +856 followed by 6-10 digits';
    return undefined;
  }
  return { phone, phone_display: phone_display || phone };
}

function validateParking(parking, errors) {
  if (parking === null) return null;
  if (typeof parking !== 'object' || Array.isArray(parking)) {
    errors.parking = 'invalid parking';
    return undefined;
  }
  const note = typeof parking.note === 'string' ? parking.note.trim() : '';
  const source = typeof parking.source === 'string' ? parking.source.trim() : '';
  if (!note) return null;
  if (note.length > MAX_PARKING_NOTE) {
    errors.parking = `note must be ${MAX_PARKING_NOTE} characters or fewer`;
    return undefined;
  }
  return { note, source: source || 'venue told us' };
}

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

// photos: reorder/remove only this pass (no image upload) — every submitted
// URL must already exist in the venue's current photos, or the whole
// request is rejected. This is a value-level check, not just a field-
// presence whitelist: the field name being writable doesn't mean any string
// is acceptable in it.
function validatePhotos(photos, currentPhotos, errors) {
  if (!Array.isArray(photos)) {
    errors.photos = 'invalid photos';
    return undefined;
  }
  const currentSet = new Set(currentPhotos);
  for (const p of photos) {
    if (typeof p !== 'string' || !currentSet.has(p)) {
      errors.photos = 'photo upload is not available yet — you can only reorder or remove existing photos';
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
      'SELECT photos, links FROM venues WHERE id = ?'
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

    for (const field of SIMPLE_FIELDS) {
      if (!(field in body)) continue;
      const v = body[field];
      if (field === 'type') {
        if (!VENUE_TYPES.includes(v)) { errors.type = 'must be bar, cafe, or venue'; continue; }
      } else {
        if (typeof v !== 'string') { errors[field] = 'must be text'; continue; }
        const trimmed = v.trim();
        if (field === 'name' && !trimmed) { errors[field] = "name can't be empty"; continue; }
        if (trimmed.length > MAX_LEN[field]) {
          errors[field] = `must be ${MAX_LEN[field]} characters or fewer`;
          continue;
        }
      }
      sets.push(`${field} = ?`);
      binds.push(field === 'type' ? v : v.trim());
    }

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
      const photos = validatePhotos(body.photos, currentPhotos, errors);
      if (photos !== undefined) { sets.push('photos = ?'); binds.push(JSON.stringify(photos)); }
    }

    if (Object.keys(errors).length > 0) {
      return Response.json({ ok: false, errors }, { status: 400 });
    }
    if (sets.length === 0) {
      return Response.json({ ok: false, error: 'nothing to update' }, { status: 400 });
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
              description, photos, hours, contact, parking, links,
              verified, status, source
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
      links: updated.links ? JSON.parse(updated.links) : {},
      verified: !!updated.verified,
      source: updated.source,
    };
    if (updated.contact !== null) venue.contact = JSON.parse(updated.contact);
    if (updated.parking !== null) venue.parking = JSON.parse(updated.parking);
    if (updated.status !== null) venue.status = updated.status;

    return Response.json({ ok: true, venue, location_review: locationReview });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: 'update failed' }, { status: 500 });
  }
}
