// Admin gate shared by every admin-only endpoint (functions/api/pending.js,
// functions/api/venues/[id]/approve.js, functions/api/venues/[id]/reject.js)
// and by functions/api/me.js (which surfaces is_admin so the client knows
// whether to show admin UI at all). Membership in ADMIN_USER_IDS (a
// Cloudflare Pages env var, comma-separated numeric user ids) — not a role
// column in the DB, since there's exactly one admin today.
//
// To find your own user id: wrangler d1 execute muan-db --remote --command
// ="SELECT id, handle FROM users" — then set ADMIN_USER_IDS to that id in
// the Cloudflare Pages dashboard (Settings -> Environment variables).
//
// The client is told is_admin so it can show/hide a menu entry — that's a
// UX convenience only. Every admin write re-checks isAdmin() against the
// session's own user id server-side; a client claiming admin status is
// never trusted (see approve.js/reject.js).
export function adminUserIds(context) {
  return (context.env.ADMIN_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
}

export function isAdmin(context, user) {
  return !!user && adminUserIds(context).includes(user.id);
}
