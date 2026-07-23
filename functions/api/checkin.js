import { getSessionUser } from './_auth.js';

const PHAI_STAGES = ['ember', 'flicker', 'flame', 'blaze', 'naga'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/* IMPORTANT: this table must be kept in sync with data/venues.json.
   Every new venue added there must be added here too, or check-ins at it
   will fail with "unknown venue". */
const VENUE_COORDS = {
  "kong-view": { lat: 17.9678909, lng: 102.5805278, name: "Kong View" },
  "chokdee-cafe": { lat: 17.9630719, lng: 102.6058379, name: "Chokdee Café Belgian Beer Bar" },
  "sinouk-khemkhong": { lat: 17.9636131, lng: 102.6039109, name: "Café Sinouk Khemkhong" },
  "itecc-hall": { lat: 17.9607924, lng: 102.6439024, name: "ITECC" },
  "go-dunk": { lat: 17.9690462, lng: 102.6103675, name: "Go Dunk" },
  "status-bar": { lat: 17.969079, lng: 102.609883, name: "Status" },
  "rustic-white": { lat: 17.9582834, lng: 102.6107121, name: "Rustic" },
  "baron": { lat: 17.9632547, lng: 102.6054528, name: "Baron" },
  "mahasan": { lat: 17.9631989, lng: 102.6054431, name: "Mahasan" },
  "treekoff-watchane": { lat: 17.9663429, lng: 102.6018097, name: "Treekoff" },
  "tree-town": { lat: 17.9650688, lng: 102.6021906, name: "Tree Town" },
  "common-grounds": { lat: 17.964785, lng: 102.6026191, name: "Common Grounds" },
  "drip-1920s": { lat: 17.9695095, lng: 102.6052324, name: "Drip 1920s" },
  "maomao-matcha": { lat: 17.9737332, lng: 102.6338178, name: "MaoMao" },
  "vte-night-market": { lat: 17.9628193, lng: 102.6061735, name: "Vientiane Night Market" },
  "night-street": { lat: 17.9604, lng: 102.6085, name: "Night Street" },
  "farsai-cafe": { lat: 18.0083709, lng: 102.6436896, name: "Farsai Cafe & Restaurant" },
  "corebeer": { lat: 17.9491828, lng: 102.6190028, name: "Corebeer Brewery" },
  "parkson-laos": { lat: 17.9613647, lng: 102.61853, name: "Parkson (Naga Mall)" },
  "kokkok-mega-mall": { lat: 17.9760734, lng: 102.6247692, name: "KOKKOK Mega Mall Patuxay" }
};

/* hours duplicated from venues.json — keep in sync when adding venues */
const VENUE_HOURS = {
  "kong-view": {
    mon: "16:30-23:30", tue: "16:30-23:30", wed: "16:30-23:30",
    thu: "16:30-23:30", fri: "16:30-23:30", sat: "16:30-23:30", sun: "16:30-23:30"
  },
  "chokdee-cafe": {
    mon: "10:00-23:30", tue: "10:00-23:30", wed: "10:00-23:30",
    thu: "10:00-23:30", fri: "10:00-23:30", sat: "10:00-23:30", sun: "10:00-23:30"
  },
  "sinouk-khemkhong": {
    mon: "07:00-22:00", tue: "07:00-22:00", wed: "07:00-22:00",
    thu: "07:00-22:00", fri: "07:00-22:00", sat: "07:00-22:00", sun: "07:00-22:00"
  },
  "itecc-hall": null,
  "go-dunk": null,
  "status-bar": null,
  "rustic-white": {
    mon: "19:00-24:00", tue: "19:00-24:00", wed: "19:00-24:00",
    thu: "19:00-24:00", fri: "19:00-24:00", sat: "19:00-24:00", sun: "19:00-24:00"
  },
  "baron": {
    mon: "20:00-26:00", tue: null, wed: "20:00-26:00",
    thu: "20:00-26:00", fri: "20:00-27:00", sat: "20:00-27:00", sun: "20:00-26:00"
  },
  "mahasan": null,
  "treekoff-watchane": {
    mon: "06:30-22:00", tue: "06:30-22:00", wed: "06:30-22:00",
    thu: "06:30-22:00", fri: "06:30-22:00", sat: "06:30-22:00", sun: "06:30-22:00"
  },
  "tree-town": {
    mon: null, tue: "09:00-22:00", wed: "09:00-22:00",
    thu: "09:00-22:00", fri: "09:00-22:00", sat: "09:00-22:00", sun: "09:00-22:00"
  },
  "common-grounds": {
    mon: "07:00-20:00", tue: "07:00-20:00", wed: "07:00-20:00",
    thu: "07:00-20:00", fri: "07:00-20:00", sat: "07:00-20:00", sun: null
  },
  "drip-1920s": {
    mon: "07:00-20:00", tue: "07:00-20:00", wed: "07:00-20:00",
    thu: "07:00-24:00", fri: "07:00-24:00", sat: "07:00-24:00", sun: "07:00-24:00"
  },
  "maomao-matcha": {
    mon: "07:30-16:30", tue: "07:30-16:30", wed: "07:30-16:30",
    thu: "07:30-16:30", fri: "07:30-16:30", sat: null, sun: "07:30-16:30"
  },
  "vte-night-market": {
    mon: "18:00-22:00", tue: "18:00-22:00", wed: "18:00-22:00",
    thu: "18:00-22:00", fri: "18:00-22:00", sat: "18:00-22:00", sun: "18:00-22:00"
  },
  "night-street": null,
  "farsai-cafe": {
    mon: "10:00-22:00", tue: "10:00-22:00", wed: "10:00-22:00",
    thu: "10:00-22:00", fri: "10:00-22:00", sat: "10:00-22:00", sun: "10:00-22:00"
  },
  "corebeer": {
    mon: "11:00-22:30", tue: "11:00-22:30", wed: "11:00-22:30",
    thu: "11:00-23:00", fri: "11:00-23:00", sat: "11:00-23:00", sun: "11:00-22:30"
  },
  "parkson-laos": {
    mon: "09:30-21:00", tue: "09:30-21:00", wed: "09:30-21:00",
    thu: "09:30-21:00", fri: "09:30-21:00", sat: "09:30-21:00", sun: "09:30-21:00"
  },
  "kokkok-mega-mall": null
};

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

function parseHoursRange(str) {
  if (!str) return null;
  const [a, b] = str.split('-');
  const toMins = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  return { open: toMins(a), close: toMins(b) };
}

/* Vientiane is UTC+7 year-round (no DST) — shift the UTC clock and read it
   back with the UTC getters so this doesn't depend on the server's own TZ. */
function isVenueOpen(hours) {
  if (!hours) return true;
  const vt = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const today = DAYS[vt.getUTCDay()];
  const yesterday = DAYS[(vt.getUTCDay() + 6) % 7];
  const mins = vt.getUTCHours() * 60 + vt.getUTCMinutes();

  const y = parseHoursRange(hours[yesterday]);
  if (y && y.close > 1440 && mins < y.close - 1440) return true;

  const t = parseHoursRange(hours[today]);
  if (!t) return false;
  if (mins < t.open) return false;
  if (mins < Math.min(t.close, 1440) || t.close > 1440) return true;
  return false;
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405 });
  }

  try {
    const user = await getSessionUser(context);
    if (!user) return Response.json({ ok: false, need_auth: true }, { status: 401 });

    const body = await context.request.json().catch(() => null);
    const venue_id = body ? body.venue_id : undefined;
    const lat = body ? body.lat : undefined;
    const lng = body ? body.lng : undefined;

    if (venue_id === undefined || venue_id === null ||
        lat === undefined || lat === null ||
        lng === undefined || lng === null) {
      return Response.json({ ok: false, error: 'missing venue_id, lat or lng' }, { status: 400 });
    }

    const venue = VENUE_COORDS[venue_id];
    if (!venue) {
      return Response.json({ ok: false, error: 'unknown venue' }, { status: 404 });
    }

    const configRows = await context.env.DB.prepare(
      `SELECT key, value FROM config WHERE key IN
       ('checkin_radius_m','ember_base','ember_new_venue','ember_repeat','ember_event','phai_thresholds')`
    ).all();
    const config = {};
    for (const row of configRows.results) config[row.key] = row.value;

    const radiusM = config.checkin_radius_m !== undefined ? Number(config.checkin_radius_m) : 150;
    const emberNewVenue = config.ember_new_venue !== undefined ? Number(config.ember_new_venue) : 25;
    const emberRepeat = config.ember_repeat !== undefined ? Number(config.ember_repeat) : 5;
    const phaiThresholds = config.phai_thresholds
      ? JSON.parse(config.phai_thresholds)
      : [0, 100, 400, 1200, 3000];

    const distanceM = haversineMeters(lat, lng, venue.lat, venue.lng);
    if (distanceM > radiusM) {
      return Response.json({
        ok: false,
        too_far: true,
        distance_m: Math.round(distanceM),
        radius_m: radiusM,
      });
    }

    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const recentAtVenue = await context.env.DB.prepare(
      `SELECT id FROM checkins WHERE user_id = ? AND venue_id = ? AND created_at > ? LIMIT 1`
    ).bind(user.id, venue_id, fourHoursAgo).first();
    if (recentAtVenue) {
      return Response.json({ ok: false, already: true, message: 'already checked in here recently' });
    }

    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const tonightCount = await context.env.DB.prepare(
      `SELECT COUNT(*) as c FROM checkins WHERE user_id = ? AND created_at > ?`
    ).bind(user.id, sixHoursAgo).first();
    if (tonightCount.c >= 6) {
      return Response.json({ ok: false, limit: true, message: 'check-in limit reached for tonight' });
    }

    if (!isVenueOpen(VENUE_HOURS[venue_id])) {
      return Response.json({ ok: false, closed: true, message: 'that place is closed right now' });
    }

    const lastCheckin = await context.env.DB.prepare(
      `SELECT lat, lng, created_at FROM checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`
    ).bind(user.id).first();
    if (lastCheckin) {
      const minutesSince = (Date.now() - new Date(lastCheckin.created_at).getTime()) / 60000;
      if (minutesSince < 60) {
        const movedM = haversineMeters(lastCheckin.lat, lastCheckin.lng, lat, lng);
        if (movedM < 200) {
          return Response.json({ ok: false, same_spot: true, message: "you haven't moved since your last check-in" });
        }
      }
    }

    const nowIso = new Date().toISOString();
    const currentMonth = nowIso.slice(0, 7);

    const priorVisits = await context.env.DB.prepare(
      `SELECT COUNT(*) as c FROM checkins WHERE user_id = ? AND venue_id = ?`
    ).bind(user.id, venue_id).first();
    const firstVisit = priorVisits.c === 0;

    const monthlyVisits = await context.env.DB.prepare(
      `SELECT COUNT(*) AS c FROM checkins WHERE user_id = ? AND venue_id = ? AND substr(created_at,1,7) = ?`
    ).bind(user.id, venue_id, currentMonth).first();

    let embersEarned;
    if (firstVisit) {
      embersEarned = emberNewVenue;
    } else if (monthlyVisits.c <= 2) {
      embersEarned = emberRepeat;
    } else if (monthlyVisits.c <= 6) {
      embersEarned = 2;
    } else {
      embersEarned = 1;
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const dailyEmbers = await context.env.DB.prepare(
      `SELECT COALESCE(SUM(embers),0) AS s FROM checkins WHERE user_id = ? AND created_at > ?`
    ).bind(user.id, oneDayAgo).first();
    const capped = dailyEmbers.s >= 100;
    if (capped) embersEarned = 0;

    const priorEmbersTotal = user.embers_total ?? 0;
    const priorStreakMonths = user.streak_months ?? 0;
    const priorLastCheckinMonth = user.last_checkin_month ?? null;

    await context.env.DB.prepare(
      `INSERT INTO checkins (user_id, venue_id, created_at, lat, lng, embers) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(user.id, venue_id, nowIso, lat, lng, embersEarned).run();

    const embersTotal = priorEmbersTotal + embersEarned;
    let streakMonths = priorStreakMonths;
    let lastCheckinMonth = priorLastCheckinMonth;
    if (lastCheckinMonth !== currentMonth) {
      streakMonths += 1;
      lastCheckinMonth = currentMonth;
    }

    await context.env.DB.prepare(
      `UPDATE users SET embers_total = ?, streak_months = ?, last_checkin_month = ? WHERE id = ?`
    ).bind(embersTotal, streakMonths, lastCheckinMonth, user.id).run();

    let stageIndex = 0;
    for (let i = 0; i < phaiThresholds.length; i++) {
      if (embersTotal >= phaiThresholds[i]) stageIndex = i;
    }
    const phaiStage = PHAI_STAGES[stageIndex];

    return Response.json({
      ok: true,
      venue: venue.name,
      embers_earned: embersEarned,
      embers_total: embersTotal,
      first_visit: firstVisit,
      streak_months: streakMonths,
      phai_stage: phaiStage,
      venue_checkins: priorVisits.c + 1,
      capped,
    });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: "check-in failed" }, { status: 500 });
  }
}
