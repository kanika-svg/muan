// The check-in radius, read from ONE place: the `checkin_radius_m` row of D1's
// `config` table (seeded by schema.sql). Both consumers go through here —
// functions/api/checkin.js, which enforces it, and the GET in
// functions/api/venues.js, which hands the same number to the client so the
// "You're here — check in" button agrees with the server.
//
// Before 2026-09-15 the client decided "you're close enough" with its own
// hardcoded 150 while checkin.js read the config row (with a second 150 as
// its fallback) — three spellings of one number, the two-values-that-must-
// agree pattern CLAUDE.md's history is made of. Change the config row and
// the button would have offered check-ins the server then refused.
//
// The client now carries no copy at all: if it does not have the server's
// number yet (the bundled-mirror boot path, or a stale /api/venues), it lets
// the tap through and the server answers. So the only other literal left is
// the guard below, used ONLY when the config row is missing, and logged
// loudly when it is — a missing seed row is a real problem to go and fix,
// not something to paper over silently.
const MISSING_ROW_FALLBACK_M = 150;

export function checkinRadiusFrom(value) {
  const n = Number(value);
  if (value === undefined || value === null || value === '' || !Number.isFinite(n) || n <= 0) {
    console.error(`config.checkin_radius_m is missing or invalid (${JSON.stringify(value)}) — using ${MISSING_ROW_FALLBACK_M}m. Seed the row (see schema.sql).`);
    return MISSING_ROW_FALLBACK_M;
  }
  return n;
}

export async function readCheckinRadius(db) {
  const row = await db.prepare("SELECT value FROM config WHERE key = 'checkin_radius_m'").first();
  return checkinRadiusFrom(row?.value);
}
