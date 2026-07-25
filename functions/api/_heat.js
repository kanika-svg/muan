/* heat = how brightly the flame burns right now, decayed from recent check-ins.
   Separate from phai_stage (lifetime rank, never falls) — heat is a mood, not
   a rank, and is always derived here rather than stored, so it can't drift. */
export async function computeHeat(db, userId) {
  const rows = await db.prepare(
    "SELECT created_at, embers FROM checkins WHERE user_id = ? AND created_at > ?"
  ).bind(userId, new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString()).all();

  const now = Date.now();
  let heat = 0;
  for (const r of rows.results) {
    const days = (now - new Date(r.created_at).getTime()) / 86400000;
    heat += (r.embers || 0) * Math.pow(0.82, days);   // ~18% cooler per day
  }
  heat = Math.round(heat);

  const heatLevel = heat >= 60 ? 'roaring'
                  : heat >= 30 ? 'burning'
                  : heat >= 10 ? 'warm'
                  : heat > 0   ? 'glowing'
                  : 'cold';

  return { heat, heat_level: heatLevel };
}
