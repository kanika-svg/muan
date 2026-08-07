import { getSessionUser } from './_auth.js';
import { adminUserIds } from './_admin.js';

// GET /api/pending — venues owners have submitted (pin_status = 'pending',
// migrations/009_pin_status.sql) that Kar hasn't placed on the map yet.
// Admin-gated by user id (see ./_admin.js). Surfaced in the flame sheet's
// "Pending venues (N)" admin entry (js/app.js openAdminPendingSheet()),
// approved/rejected via POST /api/venues/:id/approve|reject.
//
// Each venue's Maps link is resolved server-side into suggested_lat/
// suggested_lng (see resolveMapsCoords() below) so Kar isn't starting from
// nothing on a phone — but "suggested" is the operative word: this is a
// parsed guess, never written to the venues table directly, and the admin
// view lets Kar edit it before approving. If resolution fails, both come
// back null and Kar enters coordinates by hand.

const COORD_RE = /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/;

// only ever fetches Google's own short-link domains — the maps_url field is
// owner input, and following an arbitrary owner-supplied URL server-side on
// every admin page load is an open redirect/SSRF surface we don't need:
// nothing here needs to resolve a link that isn't actually a Maps share link
const RESOLVABLE_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl']);

// A full (non-shortened) Maps URL already carries "@lat,lng" — no fetch
// needed. A share link (maps.app.goo.gl/xxxx) is a Firebase Dynamic Link
// that 302-redirects straight to that full URL; Cloudflare Workers' fetch()
// with redirect: 'manual' exposes the real status code and Location header
// on that redirect (unlike a browser's fetch, which opaques it), so this
// reads the coordinates off the Location header without ever downloading
// the Maps page itself. Verified against real maps.app.goo.gl links: a
// single 302 hop, Location already contains "@lat,lng,zoom" — see the task
// report for what was checked. Capped at a few hops in case Google ever
// inserts an intermediate redirect (e.g. a consent gate) that this can't
// authenticate through anyway; those cases just fall through to null.
async function resolveMapsCoords(mapsUrl) {
  if (!mapsUrl) return null;
  const direct = mapsUrl.match(COORD_RE);
  if (direct) return { lat: Number(direct[1]), lng: Number(direct[2]) };

  let url;
  try { url = new URL(mapsUrl); } catch { return null; }
  if (!RESOLVABLE_HOSTS.has(url.hostname)) return null;

  for (let hop = 0; hop < 4; hop++) {
    let res;
    try {
      res = await fetch(url.toString(), { method: 'GET', redirect: 'manual' });
    } catch {
      return null;
    }
    if (res.status < 300 || res.status >= 400) return null;
    const loc = res.headers.get('Location');
    if (!loc) return null;
    const next = new URL(loc, url);
    const m = next.href.match(COORD_RE);
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
    url = next;
  }
  return null;
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

    const venues = await Promise.all(rows.results.map(async (r) => {
      const mapsUrl = r.links ? (JSON.parse(r.links).maps || null) : null;
      const coords = await resolveMapsCoords(mapsUrl);
      return {
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
        maps_url: mapsUrl,
        // suggested, not confirmed — parsed off the Maps link, never
        // written to the venues table unless Kar approves (functions/api/
        // venues/[id]/approve.js), and editable in the admin view either way
        suggested_lat: coords ? coords.lat : null,
        suggested_lng: coords ? coords.lng : null,
        submitted_by: r.submitted_by,
        submitted_at: r.updated_at,
      };
    }));

    return Response.json({ ok: true, venues });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: 'pending fetch failed' }, { status: 500 });
  }
}
