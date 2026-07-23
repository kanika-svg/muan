import { sessionCookie } from '../_auth.js';

const GOOGLE_CLIENT_ID = '768624583305-553qrbhib2mqbbi10ifsr18b8uqu4uvk.apps.googleusercontent.com';

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405 });
  }

  try {
    const body = await context.request.json().catch(() => null);
    const credential = body ? body.credential : undefined;
    if (!credential) {
      return Response.json({ ok: false, error: 'missing credential' }, { status: 400 });
    }

    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
    if (!r.ok) return Response.json({ ok: false, error: 'invalid token' }, { status: 401 });
    const info = await r.json();

    if (info.aud !== GOOGLE_CLIENT_ID || !info.sub) {
      return Response.json({ ok: false, error: 'invalid token' }, { status: 401 });
    }

    const db = context.env.DB;
    const nowIso = new Date().toISOString();

    let user = await db.prepare('SELECT id FROM users WHERE google_sub = ?').bind(info.sub).first();
    if (!user) {
      const handle = (info.name || (info.email ? info.email.split('@')[0] : '') || 'friend').slice(0, 24);
      const inserted = await db.prepare(
        `INSERT INTO users (google_sub, handle, created_at, embers_total, streak_months)
         VALUES (?, ?, ?, 0, 0)`
      ).bind(info.sub, handle, nowIso).run();
      user = { id: inserted.meta.last_row_id, handle };
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await db.prepare(
      `INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`
    ).bind(token, user.id, nowIso, expiresAt).run();

    const handleRow = user.handle ? user : await db.prepare('SELECT handle FROM users WHERE id = ?').bind(user.id).first();

    return Response.json(
      { ok: true, handle: handleRow.handle },
      { headers: { 'Set-Cookie': sessionCookie(token, 60 * 60 * 24 * 30) } }
    );
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: 'auth failed' }, { status: 500 });
  }
}
