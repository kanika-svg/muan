import { getSessionUser } from '../../_auth.js';
import { isAdmin } from '../../_admin.js';

// POST /api/venues/:id/approve — Kar confirming a pending owner submission's
// location from the admin review page (js/app.js openAdminPendingSheet()).
// Admin-gated by user id (see ../../_admin.js) — 403 for anyone else,
// including the venue's own owner; a client claiming admin status is never
// trusted, only the session's own user id is checked, same as
// functions/api/pending.js.
//
// lat/lng arrive from the admin form, pre-filled with /api/pending's
// suggested_lat/suggested_lng but editable — Kar is confirming a real
// coordinate here, not rubber-stamping a guess, so this endpoint accepts
// whatever the form sends rather than re-deriving it from the Maps link
// itself.
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
    const lat = Number(body?.lat);
    const lng = Number(body?.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
        !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return Response.json({ ok: false, error: 'valid lat/lng required' }, { status: 400 });
    }

    const db = context.env.DB;
    const existing = await db.prepare('SELECT id FROM venues WHERE id = ?').bind(venueId).first();
    if (!existing) return Response.json({ ok: false, error: 'not found' }, { status: 404 });

    const nowIso = new Date().toISOString();
    const source = `owner submission, confirmed ${nowIso.slice(0, 10)}`;

    await db.prepare(
      `UPDATE venues SET lat = ?, lng = ?, pin_status = 'placed', verified = 1,
         source = ?, rejection_reason = NULL, updated_at = ? WHERE id = ?`
    ).bind(lat, lng, source, nowIso, venueId).run();

    // so the pin appears on the public map immediately instead of waiting
    // out the hour-long TTL — same cache/key this mirrors as functions/api/
    // venues/[id].js's owner-edit path
    const publicVenuesUrl = new URL('/api/venues', context.request.url).toString();
    await caches.default.delete(new Request(publicVenuesUrl, { method: 'GET' }));

    return Response.json({ ok: true });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: 'approve failed' }, { status: 500 });
  }
}
