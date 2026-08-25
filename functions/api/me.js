import { getSessionUser } from './_auth.js';
import { computeHeat } from './_heat.js';
import { isAdmin } from './_admin.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET')
    return Response.json({ ok:false, error:'method not allowed' }, { status:405 });
  try {
    const db = context.env.DB;
    const user = await getSessionUser(context);
    if (!user) return Response.json({ ok:true, signed_out:true });

    const month = new Date().toISOString().slice(0,7); // YYYY-MM
    const days = await db.prepare(
      "SELECT DISTINCT substr(created_at,1,10) AS d FROM checkins WHERE user_id=? AND substr(created_at,1,7)=?"
    ).bind(user.id, month).all();
    const venues = await db.prepare(
      'SELECT COUNT(DISTINCT venue_id) AS c FROM checkins WHERE user_id=?'
    ).bind(user.id).first();
    const venueCountRows = await db.prepare(
      'SELECT venue_id, COUNT(*) AS c FROM checkins WHERE user_id=? GROUP BY venue_id'
    ).bind(user.id).all();
    const total = await db.prepare(
      'SELECT COUNT(*) AS c FROM checkins WHERE user_id=?'
    ).bind(user.id).first();

    const badgeRows = await db.prepare(
      `SELECT b.code AS id, b.name, b.name_lo, b.icon, b.rule AS description, ub.earned_at
       FROM user_badges ub JOIN badges b ON b.code = ub.badge_code
       WHERE ub.user_id = ? ORDER BY ub.earned_at`
    ).bind(user.id).all();

    const cfg = await db.prepare("SELECT value FROM config WHERE key='phai_thresholds'").first();
    const thresholds = JSON.parse(cfg?.value || '[0,100,400,1200,3000]');
    const stages = ['ember','flicker','flame','blaze','naga'];
    let stage = 'ember';
    thresholds.forEach((t,i) => { if (user.embers_total >= t) stage = stages[i]; });

    const { heat, heat_level } = await computeHeat(db, user.id);

    // first-ever sign-in only; a returning account with real check-ins
    // (e.g. a new device) already knows what the flame is
    const showIntro = !user.intro_seen && (total?.c || 0) === 0;

    return Response.json({
      ok: true,
      show_intro: showIntro,
      // one-time first-open mood chooser (see showMoodIntro() in js/app.js)
      // — read only when this user is signed in; an anonymous visitor is
      // gated by localStorage instead (see migrations/014_mood_intro_seen.sql)
      mood_intro_seen: !!user.mood_intro_seen,
      // display-only — every admin write re-checks this same isAdmin() call
      // against the session's own user id server-side (see functions/api/
      // venues/[id]/approve.js, reject.js); a client can't grant itself
      // admin by faking this field, only by having a session that qualifies
      is_admin: isAdmin(context, user),
      handle: user.handle,
      avatar_url: user.avatar_url || null,
      embers_total: user.embers_total || 0,
      streak_months: user.streak_months || 0,
      phai_stage: stage,
      heat,
      heat_level,
      checkin_days: days.results.map(r => r.d),
      venue_counts: Object.fromEntries(venueCountRows.results.map(r => [r.venue_id, r.c])),
      venues_explored: venues?.c || 0,
      total_checkins: total?.c || 0,
      badges: badgeRows.results,
      month
    });
  } catch (e) {
    console.error(e);
    return Response.json({ ok:false, error:'stats failed' }, { status:500 });
  }
}
