import { sessionCookie } from '../_auth.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405 });
  }

  try {
    const cookie = context.request.headers.get('Cookie') || '';
    const m = cookie.match(/(?:^|;\s*)psd_session=([A-Za-z0-9-]+)/);
    if (m) {
      await context.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(m[1]).run();
    }
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie('', 0) } });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie('', 0) } });
  }
}
