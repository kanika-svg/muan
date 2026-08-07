/* must mirror the maxBounds used in initMap() (js/app.js) */
const BOUNDS = { minLng: 102.45, minLat: 17.85, maxLng: 102.82, maxLat: 18.15 };
const MODES = ['driving-car', 'foot-walking'];
const MAX_ORIGIN_KM = 60;

/* copied from functions/api/checkin.js — keep in sync */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function inBounds(lat, lng) {
  return lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat &&
    lng >= BOUNDS.minLng && lng <= BOUNDS.maxLng;
}

/* the destination is fenced tight to Vientiane — every venue lives in that
   box, so this is the real anti-abuse guard: the endpoint can only route TO
   our venues' area, not serve as a general routing proxy. The origin is
   loose (any point within 60km of the destination) because users legitimately
   open the app from outside the city centre — the airport, a bus in from
   another province, etc — and still want directions in. */
function validCoords(fromLat, fromLng, toLat, toLng) {
  if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) return false;
  if (!inBounds(toLat, toLng)) return false;
  const originKm = haversineMeters(fromLat, fromLng, toLat, toLng) / 1000;
  return originKm <= MAX_ORIGIN_KM;
}

export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405 });
  }

  try {
    const params = new URL(context.request.url).searchParams;
    const from_lat = Number(params.get('from_lat'));
    const from_lng = Number(params.get('from_lng'));
    const to_lat = Number(params.get('to_lat'));
    const to_lng = Number(params.get('to_lng'));
    const mode = params.get('mode') || 'driving-car';

    if (!MODES.includes(mode) ||
        !validCoords(from_lat, from_lng, to_lat, to_lng)) {
      return Response.json({ ok: false }, { status: 200 });
    }

    // round to 4dp (~11m) so two requests from roughly the same spot to the
    // same venue collide on one cache entry instead of each raw GPS reading
    // (which never repeats exactly) missing the edge cache and hitting ORS.
    // Cloudflare's default cache key is the incoming request URL, which
    // still carries the client's raw coordinates — so the rounded values
    // are used to build an explicit second cache key below rather than
    // relying on Cache-Control alone to dedupe them.
    const round4 = n => Math.round(n * 10000) / 10000;
    const rFromLat = round4(from_lat), rFromLng = round4(from_lng);
    const rToLat = round4(to_lat), rToLng = round4(to_lng);

    const cache = caches.default;
    const cacheKeyUrl = new URL(context.request.url);
    cacheKeyUrl.search = new URLSearchParams({
      from_lat: rFromLat, from_lng: rFromLng, to_lat: rToLat, to_lng: rToLng, mode,
    }).toString();
    const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });

    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    // mode must be a valid ORS profile — 'driving-car' or 'foot-walking'
    const orsUrl = `https://api.openrouteservice.org/v2/directions/${mode}/geojson`;

    const orsRes = await fetch(orsUrl, {
      method: 'POST',
      headers: {
        'Authorization': context.env.ORS_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/geo+json',
      },
      body: JSON.stringify({
        coordinates: [[rFromLng, rFromLat], [rToLng, rToLat]],
      }),
    });
    const text = await orsRes.text();
    if (!orsRes.ok) return Response.json({ ok: false }, { status: 200 });

    let data;
    try { data = JSON.parse(text); }
    catch { return Response.json({ ok: false }, { status: 200 }); }

    const feat = data.features?.[0];
    if (!feat?.properties?.summary) return Response.json({ ok: false }, { status: 200 });

    const response = Response.json({
      ok: true,
      distance_m: Math.round(feat.properties.summary.distance),
      duration_s: Math.round(feat.properties.summary.duration),
      geometry: feat.geometry,
      mode,
    }, { headers: { 'Cache-Control': 'public, max-age=86400' } });

    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false }, { status: 200 });
  }
}
