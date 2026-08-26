import { getSessionUser } from './_auth.js';
import { adminUserIds } from './_admin.js';

// GET /api/mood-stats — counts per tag from mood_picks (migrations/
// 015_mood_picks.sql), split by time_bucket. Admin-gated by user id (see
// ./_admin.js), same pattern as functions/api/pending.js. No UI: reading
// the JSON is enough for now (see the task that added this table).
export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405 });
  }

  try {
    const user = await getSessionUser(context);
    if (!user) return Response.json({ ok: false, need_auth: true }, { status: 401 });

    const admins = adminUserIds(context);
    if (!admins.includes(user.id)) {
      return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
    }

    const rows = await context.env.DB.prepare(
      `SELECT tag, time_bucket, COUNT(*) AS count
       FROM mood_picks
       GROUP BY tag, time_bucket
       ORDER BY tag, time_bucket`
    ).all();

    return Response.json({ ok: true, stats: rows.results });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: 'mood stats fetch failed' }, { status: 500 });
  }
}
