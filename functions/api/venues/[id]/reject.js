import { getSessionUser } from '../../_auth.js';
import { isAdmin } from '../../_admin.js';

const MAX_REASON_LEN = 300;

// POST /api/venues/:id/reject — Kar turning down a pending owner submission
// from the admin review page. Admin-gated the same way as approve.js — 403
// unless the session's own user id is in ADMIN_USER_IDS.
//
// Never deletes the row: pin_status becomes 'rejected' and the reason is
// stored so the owner can see what happened and fix it (via /api/my-venues
// -> "Manage your venue" -> the edit form, js/app.js openVenueEditor()).
// lat/lng are left untouched (still NULL from submission — see functions/
// api/venues.js's POST handler).
export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405 });
  }

  try {
    const user = await getSessionUser(context);
    if (!user) return Response.json({ ok: false, need_auth: true }, { status: 401 });
    if (!isAdmin(context, user)) {
      return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
    }

    const venueId = context.params.id;
    const body = await context.request.json().catch(() => null);
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!reason) {
      return Response.json({ ok: false, error: 'a reason is required' }, { status: 400 });
    }
    if (reason.length > MAX_REASON_LEN) {
      return Response.json({ ok: false, error: `must be ${MAX_REASON_LEN} characters or fewer` }, { status: 400 });
    }

    const db = context.env.DB;
    const existing = await db.prepare('SELECT id FROM venues WHERE id = ?').bind(venueId).first();
    if (!existing) return Response.json({ ok: false, error: 'not found' }, { status: 404 });

    const nowIso = new Date().toISOString();
    await db.prepare(
      `UPDATE venues SET pin_status = 'rejected', rejection_reason = ?, updated_at = ? WHERE id = ?`
    ).bind(reason, nowIso, venueId).run();

    // rejected venues are already excluded from /api/venues at the query
    // level (see functions/api/venues.js), but purge anyway in case this
    // one was cached from a moment ago
    const publicVenuesUrl = new URL('/api/venues', context.request.url).toString();
    await caches.default.delete(new Request(publicVenuesUrl, { method: 'GET' }));

    return Response.json({ ok: true });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: 'reject failed' }, { status: 500 });
  }
}
