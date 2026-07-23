import { getSessionUser } from './_auth.js';

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

    return Response.json({
      ok: true,
      handle: user.handle,
      embers_total: user.embers_total || 0,
      streak_months: user.streak_months || 0,
      phai_stage: stage,
      checkin_days: days.results.map(r => r.d),
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
