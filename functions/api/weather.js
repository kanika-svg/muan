// Proxies Open-Meteo (https://open-meteo.com — no API key, but the browser
// still shouldn't call a third party directly, and this is where caching
// lives) for the Home screen weather widget (see weatherWidgetHtml() in
// js/app.js). Trimmed on purpose: Open-Meteo's response carries a full
// hourly forecast (temperature, humidity, wind, etc.) the widget never
// shows — passing that through would just be dead weight on every request,
// and it's the kind of shape a client bug could start depending on by
// accident. This endpoint reduces it to exactly what the widget reads:
// current temp, current condition code, day/night, and three numbers about
// rain in the next 6 hours — how likely at its worst, when it peaks, and
// when it starts.
//
// Same Cache API + TTL pattern as functions/api/venues.js's GET handler —
// weather doesn't change fast enough to justify hitting Open-Meteo on every
// page load, and Open-Meteo's own docs ask non-commercial callers to cache.
//
// Failure contract (network error, non-200 upstream, unexpected shape): this
// always returns { ok: false } with HTTP 200, never a 4xx/5xx. The widget's
// entire failure handling is "render nothing" (see weatherWidgetHtml()) —
// there's no error state for a non-200 to communicate that the body isn't
// already saying, and a 200 means a failure here never surfaces as a console
// network error on the client for something this decorative.
const LAT = 17.9757;
const LNG = 102.6098;
const UPSTREAM =
  'https://api.open-meteo.com/v1/forecast' +
  `?latitude=${LAT}&longitude=${LNG}` +
  '&current=temperature_2m,precipitation,weather_code,is_day' +
  '&hourly=precipitation_probability,weather_code' +
  '&forecast_hours=6&timezone=Asia%2FVientiane';

export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return Response.json({ ok: false }, { status: 200 });
  }

  const cache = caches.default;
  const cacheKey = new Request(context.request.url, { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(UPSTREAM);
    if (!res.ok) throw new Error('upstream status ' + res.status);
    const data = await res.json();

    const cur = data.current;
    const hourlyTimes = data.hourly?.time;
    const hourlyChance = data.hourly?.precipitation_probability;
    if (!cur || !Array.isArray(hourlyTimes) || !Array.isArray(hourlyChance)) {
      throw new Error('unexpected upstream shape');
    }

    // hourly.time is already local wall-clock (the &timezone=Asia/Vientiane
    // param above), e.g. "2026-08-16T20:00", so the hour is a plain
    // substring, not something to round-trip through Date() and risk the
    // *server's* timezone leaking in instead of Vientiane's.
    //
    // Two different hours, and the difference is the whole point of
    // precip_start_hour existing. peakHour is where the probability is
    // HIGHEST in the window; startHour is the FIRST hour it crosses
    // RAIN_LIKELY. Given 6pm 55%, 7pm 60%, 8pm 80%, the peak is 8pm but
    // rain is likely from 6pm. The widget names the part of the day the
    // rain STARTS in ("rain around this evening" — it used to name the
    // hour, and was softened because a grid model cannot place a convective
    // shower to the hour), and an onset is still an onset, not a peak.
    // Reading peakHour told people they had two more hours than they had.
    // RAIN_LIKELY must stay in step with RAIN_LIKELY_PCT in js/app.js: the
    // client decides whether to show the rain treatment at all from
    // precip_chance, and this decides which hour that sentence names. If
    // the two drifted apart the widget could say "rain likely" with no hour
    // to name, or name an hour for a forecast it then decided was fine.
    const RAIN_LIKELY = 50;
    let peakChance = 0, peakHour = null, startHour = null;
    for (let i = 0; i < hourlyTimes.length; i++) {
      const chance = hourlyChance[i] ?? 0;
      if (chance > peakChance) {
        peakChance = chance;
        peakHour = Number(hourlyTimes[i].slice(11, 13));
      }
      if (startHour === null && chance >= RAIN_LIKELY) {
        startHour = Number(hourlyTimes[i].slice(11, 13));
      }
    }

    const body = {
      ok: true,
      temp_c: Math.round(cur.temperature_2m),
      code: cur.weather_code,
      is_day: !!cur.is_day,
      precip_chance: peakChance,
      precip_peak_hour: peakHour,
      precip_start_hour: startHour,
    };

    const response = Response.json(body, {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (e) {
    console.error('weather fetch failed:', e);
    return Response.json({ ok: false }, { status: 200 });
  }
}
