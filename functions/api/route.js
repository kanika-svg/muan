/* must mirror the maxBounds used in initMap() (js/app.js) */
const BOUNDS = { minLng: 102.49, minLat: 17.88, maxLng: 102.75, maxLat: 18.05 };
const MODES = ['driving-car', 'foot-walking'];

function inBounds(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat &&
    lng >= BOUNDS.minLng && lng <= BOUNDS.maxLng;
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
        !inBounds(from_lat, from_lng) || !inBounds(to_lat, to_lng)) {
      return Response.json({ ok: false }, { status: 200 });
    }

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
        coordinates: [[from_lng, from_lat], [to_lng, to_lat]],
      }),
    });
    const text = await orsRes.text();
    if (!orsRes.ok) return Response.json({ ok: false }, { status: 200 });

    let data;
    try { data = JSON.parse(text); }
    catch { return Response.json({ ok: false }, { status: 200 }); }

    const feat = data.features?.[0];
    if (!feat?.properties?.summary) return Response.json({ ok: false }, { status: 200 });

    return Response.json({
      ok: true,
      distance_m: Math.round(feat.properties.summary.distance),
      duration_s: Math.round(feat.properties.summary.duration),
      geometry: feat.geometry,
      mode,
    }, { headers: { 'Cache-Control': 'public, max-age=86400' } });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false }, { status: 200 });
  }
}
