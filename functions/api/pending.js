import { getSessionUser } from './_auth.js';

// GET /api/pending — venues owners have submitted (pin_status = 'pending',
// migrations/009_pin_status.sql) that Kar hasn't placed on the map yet.
// Admin-gated by user id, not a role in the DB — there's exactly one admin
// today, so ADMIN_USER_IDS (a Cloudflare Pages env var, comma-separated
// numeric user ids) is enough; no admin UI, no approve button, just this
// read-only list, per the task this was built for: "one venue at a time
// does not justify a UI."
//
// To find your own user id: wrangler d1 execute muan-db --remote --command
// ="SELECT id, handle FROM users" — then set ADMIN_USER_IDS to that id in
// the Cloudflare Pages dashboard (Settings → Environment variables).
//
// Kar's actual workflow after reading this list: check the venue's Maps
// link, then set its real lat/lng and flip pin_status to 'placed' by hand,
// e.g.
//   wrangler d1 execute muan-db --remote --command=
//     "UPDATE venues SET lat=17.9xxx, lng=102.6xxx, pin_status='placed'
//      WHERE id='some-venue-id'"
// then scripts/export-venues.js to keep data/venues.json in sync.
function adminUserIds(context) {
  return (context.env.ADMIN_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
}

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

    const db = context.env.DB;
    const rows = await db.prepare(
      `SELECT v.id, v.name, v.short_name, v.name_lo, v.type, v.area, v.short,
              v.description, v.hours, v.contact, v.parking, v.links,
              v.signature, v.updated_at, u.handle AS submitted_by
       FROM venues v
       JOIN venue_owners o ON o.venue_id = v.id
       JOIN users u ON u.id = o.user_id
       WHERE v.pin_status = 'pending'
       ORDER BY v.updated_at ASC`
    ).all();

    const venues = rows.results.map((r) => ({
      id: r.id,
      name: r.name,
      short_name: r.short_name,
      name_lo: r.name_lo,
      type: r.type,
      area: r.area,
      short: r.short,
      description: r.description,
      hours: r.hours ? JSON.parse(r.hours) : null,
      contact: r.contact ? JSON.parse(r.contact) : null,
      parking: r.parking ? JSON.parse(r.parking) : null,
      signature: r.signature ? JSON.parse(r.signature) : null,
      maps_url: r.links ? (JSON.parse(r.links).maps || null) : null,
      submitted_by: r.submitted_by,
      submitted_at: r.updated_at,
    }));

    return Response.json({ ok: true, venues });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: 'pending fetch failed' }, { status: 500 });
  }
}
