// Read-only venue list, reassembled from D1's `venues` table (see
// migrations/005_venues.sql) into the exact shape data/venues.json used to
// produce, so switching the frontend over later is a one-line fetch() swap.
//
// Not yet wired into the live app — js/app.js still fetches
// data/venues.json directly, and functions/api/checkin.js still has its own
// hardcoded VENUE_COORDS/VENUE_HOURS. This endpoint exists to be verified
// against that file before anything switches over.
export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405 });
  }

  try {
    const db = context.env.DB;
    const cache = caches.default;
    const cacheKey = new Request(context.request.url, { method: 'GET' });

    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const rows = await db.prepare(
      `SELECT id, name, short_name, name_lo, type, lat, lng, area, short,
              description, photos, hours, contact, parking, links,
              verified, status, source
       FROM venues ORDER BY rowid`
    ).all();

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
      // contact/parking/status are omitted entirely when absent, matching
      // data/venues.json's convention — never emitted as null
      if (r.contact !== null) v.contact = JSON.parse(r.contact);
      if (r.parking !== null) v.parking = JSON.parse(r.parking);
      if (r.status !== null) v.status = r.status;
      return v;
    });

    const response = Response.json(
      { venues },
      { headers: { 'Cache-Control': 'public, max-age=300' } }
    );
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: 'venues fetch failed' }, { status: 500 });
  }
}
