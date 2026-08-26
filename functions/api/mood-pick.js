import { getSessionUser } from './_auth.js';

// POST /api/mood-pick — logs one mood-chooser selection (migrations/
// 015_mood_picks.sql), the app's first analytics table. Called
// fire-and-forget from js/app.js showMoodIntro() both when a mood card is
// tapped (tag = the vibe key, e.g. "under-trees") and when "Just show me
// around" is tapped (tag = "dismissed") — knowing how many people skip the
// chooser is as useful as knowing which mood wins.
//
// Anonymous by construction, not by policy: only tag, server timestamp,
// server-derived day/night bucket, and whether a session existed are
// stored. No user id, session id, IP, or device info — signed_in is a
// bare 0/1, not a link back to who. See GET /api/mood-stats for the read
// side and its own comment for what this table can't tell you.
export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405 });
  }

  try {
    const body = await context.request.json().catch(() => null);
    const tag = body ? body.tag : undefined;
    if (!tag || typeof tag !== 'string') {
      return Response.json({ ok: false, error: 'missing tag' }, { status: 400 });
    }

    // best-effort: a session lookup failing shouldn't stop the log from
    // being written, and the client must never be blocked by this either
    // way (see CLAUDE.md fire-and-forget rule)
    let signedIn = 0;
    try {
      const user = await getSessionUser(context);
      signedIn = user ? 1 : 0;
    } catch (e) {}

    // Vientiane is UTC+7 year-round (no DST) — same shift as checkin.js's
    // vientianeNow(), so this doesn't depend on the server's own TZ and
    // matches isNight() in js/app.js (17:00 local cutoff) without trusting
    // the client's clock or timezone
    const vientianeHour = new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCHours();
    const timeBucket = vientianeHour >= 17 ? 'night' : 'day';

    await context.env.DB.prepare(
      `INSERT INTO mood_picks (tag, picked_at, time_bucket, signed_in) VALUES (?, ?, ?, ?)`
    ).bind(tag, new Date().toISOString(), timeBucket, signedIn).run();

    return Response.json({ ok: true });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: 'could not log' }, { status: 500 });
  }
}
