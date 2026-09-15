import { getSessionUser } from './_auth.js';
import { VIBE_TAGS, VENUE_TYPES } from './_venue-validation.js';

/* This endpoint takes no sign-in (a first-time visitor's intro taps are the
   point of it), so anything accepted is a row anyone can write, forever,
   with no cap. It accepted ANY string of any length as `tag`. Now only the
   vocabulary js/app.js actually logs (logMoodPick()): a vibe tag, "type:"
   a venue type, "list:" a short list key, or "dismissed". That stops
   arbitrary text and large payloads; it does NOT stop someone repeating a
   valid tag to skew the counts — that needs rate limiting, which nothing
   in this project has yet (see autonomous-run.md). */
function isKnownTag(tag) {
  if (tag === 'dismissed' || VIBE_TAGS.includes(tag)) return true;
  if (tag.startsWith('type:')) return VENUE_TYPES.includes(tag.slice(5));
  return /^list:[a-z0-9-]{1,32}$/.test(tag);
}

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
    if (!isKnownTag(tag)) {
      return Response.json({ ok: false, error: 'unknown tag' }, { status: 400 });
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
