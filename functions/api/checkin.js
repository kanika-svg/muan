import venuesData from '../../data/venues.json';

const TEST_USER_ID = 1;
const PHAI_STAGES = ['ember', 'flicker', 'flame', 'blaze', 'naga'];

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

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405 });
  }

  try {
    const body = await context.request.json().catch(() => null);
    const venue_id = body ? body.venue_id : undefined;
    const lat = body ? body.lat : undefined;
    const lng = body ? body.lng : undefined;

    if (venue_id === undefined || venue_id === null ||
        lat === undefined || lat === null ||
        lng === undefined || lng === null) {
      return Response.json({ ok: false, error: 'missing venue_id, lat or lng' }, { status: 400 });
    }

    const venue = venuesData.venues.find((v) => v.id === venue_id);
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
    ).bind(TEST_USER_ID, venue_id, fourHoursAgo).first();
    if (recentAtVenue) {
      return Response.json({ ok: false, already: true, message: 'already checked in here recently' });
    }

    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const tonightCount = await context.env.DB.prepare(
      `SELECT COUNT(*) as c FROM checkins WHERE user_id = ? AND created_at > ?`
    ).bind(TEST_USER_ID, sixHoursAgo).first();
    if (tonightCount.c >= 6) {
      return Response.json({ ok: false, limit: true, message: 'check-in limit reached for tonight' });
    }

    const priorVisits = await context.env.DB.prepare(
      `SELECT COUNT(*) as c FROM checkins WHERE user_id = ? AND venue_id = ?`
    ).bind(TEST_USER_ID, venue_id).first();
    const firstVisit = priorVisits.c === 0;
    const embersEarned = firstVisit ? emberNewVenue : emberRepeat;

    const nowIso = new Date().toISOString();

    await context.env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, google_sub, handle, created_at) VALUES (?, 'test-user-1', 'tester', ?)`
    ).bind(TEST_USER_ID, nowIso).run();

    const user = await context.env.DB.prepare(
      `SELECT embers_total, streak_months, last_checkin_month FROM users WHERE id = ?`
    ).bind(TEST_USER_ID).first();

    await context.env.DB.prepare(
      `INSERT INTO checkins (user_id, venue_id, created_at, lat, lng, embers) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(TEST_USER_ID, venue_id, nowIso, lat, lng, embersEarned).run();

    const embersTotal = user.embers_total + embersEarned;
    const currentMonth = nowIso.slice(0, 7);
    let streakMonths = user.streak_months;
    let lastCheckinMonth = user.last_checkin_month;
    if (lastCheckinMonth !== currentMonth) {
      streakMonths += 1;
      lastCheckinMonth = currentMonth;
    }

    await context.env.DB.prepare(
      `UPDATE users SET embers_total = ?, streak_months = ?, last_checkin_month = ? WHERE id = ?`
    ).bind(embersTotal, streakMonths, lastCheckinMonth, TEST_USER_ID).run();

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
    });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
