export async function onRequest(context) {
  if (context.request.method !== 'GET')
    return Response.json({ ok:false, error:'method not allowed' }, { status:405 });
  try {
    const db = context.env.DB;
    const user = await db.prepare(
      'SELECT embers_total, streak_months, last_checkin_month FROM users WHERE id = 1'
    ).first();
    if (!user) return Response.json({ ok:true, fresh:true, embers_total:0, streak_months:0, phai_stage:'ember', checkin_days:[], venues_explored:0, total_checkins:0 });

    const month = new Date().toISOString().slice(0,7); // YYYY-MM
    const days = await db.prepare(
      "SELECT DISTINCT substr(created_at,1,10) AS d FROM checkins WHERE user_id=1 AND substr(created_at,1,7)=?"
    ).bind(month).all();
    const venues = await db.prepare(
      'SELECT COUNT(DISTINCT venue_id) AS c FROM checkins WHERE user_id=1'
    ).first();
    const total = await db.prepare(
      'SELECT COUNT(*) AS c FROM checkins WHERE user_id=1'
    ).first();

    const cfg = await db.prepare("SELECT value FROM config WHERE key='phai_thresholds'").first();
    const thresholds = JSON.parse(cfg?.value || '[0,100,400,1200,3000]');
    const stages = ['ember','flicker','flame','blaze','naga'];
    let stage = 'ember';
    thresholds.forEach((t,i) => { if (user.embers_total >= t) stage = stages[i]; });

    return Response.json({
      ok: true,
      embers_total: user.embers_total || 0,
      streak_months: user.streak_months || 0,
      phai_stage: stage,
      checkin_days: days.results.map(r => r.d),
      venues_explored: venues?.c || 0,
      total_checkins: total?.c || 0,
      month
    });
  } catch (e) {
    console.error(e);
    return Response.json({ ok:false, error:'stats failed' }, { status:500 });
  }
}
