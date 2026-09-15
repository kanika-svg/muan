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
    // Number(null), Number('') and Number(false) are all 0 — a missing or
    // blank coordinate must not become a real one. The admin card sends ''
    // for a box left empty, and 0,0 passed the range check below, so an
    // unresolved Maps link could be approved onto Null Island with
    // verified = 1. CLAUDE.md: never a guessed or placeholder coordinate.
    const present = (x) => (typeof x === 'number') || (typeof x === 'string' && x.trim() !== '');
    const lat = Number(body?.lat);
    const lng = Number(body?.lng);
    if (!present(body?.lat) || !present(body?.lng) || (lat === 0 && lng === 0) ||
        !Number.isFinite(lat) || lat < -90 || lat > 90 ||
        !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return Response.json({ ok: false, error: 'valid lat/lng required' }, { status: 400 });
    }

    const db = context.env.DB;
    const existing = await db.prepare('SELECT id FROM venues WHERE id = ?').bind(venueId).first();
    if (!existing) return Response.json({ ok: false, error: 'not found' }, { status: 404 });

    /* Approval is a claim about the PIN: Kar has put it where the owner's
       Maps link says. pin_status = 'placed' is what records that. It is not
       a claim that the venue exists as described, with those hours, which is
       what `verified` means (CLAUDE.md: verified only once confirmed from a
       real source). Until 2026-09-15 this also set verified = 1 and
       overwrote `source` with "owner submission, confirmed <date>" —
       promoting an owner's unchecked description to verified on the strength
       of a map pin, and replacing whatever provenance the row had with a
       string about the pin. Both are left alone now: verified stays as the
       submission set it (false), so the venue sheet keeps saying "details
       unconfirmed — hours may differ", and source keeps saying where the
       details came from. Marking a venue verified is a separate act with
       no endpoint yet — see design/autonomous-run.md. */
    const nowIso = new Date().toISOString();

    await db.prepare(
      `UPDATE venues SET lat = ?, lng = ?, pin_status = 'placed',
         rejection_reason = NULL, updated_at = ? WHERE id = ?`
    ).bind(lat, lng, nowIso, venueId).run();

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
