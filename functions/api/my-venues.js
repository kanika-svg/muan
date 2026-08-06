import { getSessionUser } from './_auth.js';

// Venues the signed-in user owns (see migrations/006_owners.sql). Step 1 of
// the venue owner dashboard — ownership only, no editing endpoint yet, and
// nothing in the frontend calls this. Per-venue shape mirrors
// functions/api/venues.js exactly (same fields, same omit-when-absent
// convention for contact/parking/status) so a future dashboard can reuse
// the same rendering code as the public venue list; the response wrapper
// differs ({ ok, venues } here vs venues.js's bare { venues }) because this
// endpoint can fail per-request (auth) in a way venues.js can't.
//
// Deliberately NOT cached via caches.default like venues.js — that cache is
// keyed on the request URL, and this URL is identical for every signed-in
// user while the content is per-user. Caching it would leak one owner's
// venue list to another.
export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405 });
  }

  try {
    const user = await getSessionUser(context);
    if (!user) return Response.json({ ok: false, need_auth: true }, { status: 401 });

    const db = context.env.DB;
    const rows = await db.prepare(
      `SELECT v.id, v.name, v.short_name, v.name_lo, v.type, v.lat, v.lng,
              v.area, v.short, v.description, v.photos, v.hours, v.contact,
              v.parking, v.links, v.verified, v.status, v.source, v.signature
       FROM venue_owners o JOIN venues v ON v.id = o.venue_id
       WHERE o.user_id = ? ORDER BY v.rowid`
    ).bind(user.id).all();

    const venues = rows.results.map((r) => {
      const v = {
        id: r.id,
        name: r.name,
        short_name: r.short_name,
        name_lo: r.name_lo,
        type: r.type,
        lat: r.lat,
        lng: r.lng,
        area: r.area,
        short: r.short,
        description: r.description,
        photos: JSON.parse(r.photos || '[]'),
        hours: r.hours ? JSON.parse(r.hours) : null,
        links: r.links ? JSON.parse(r.links) : {},
        verified: !!r.verified,
        source: r.source,
      };
      if (r.contact !== null) v.contact = JSON.parse(r.contact);
      if (r.parking !== null) v.parking = JSON.parse(r.parking);
      if (r.status !== null) v.status = r.status;
      if (r.signature !== null) v.signature = JSON.parse(r.signature);
      return v;
    });

    return Response.json({ ok: true, venues });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: 'my-venues fetch failed' }, { status: 500 });
  }
}
