import { getSessionUser } from './_auth.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405 });
  }
  try {
    const user = await getSessionUser(context);
    if (!user) return Response.json({ ok: false, need_auth: true }, { status: 401 });

    await context.env.DB.prepare(
      'UPDATE users SET mood_intro_seen = 1 WHERE id = ?'
    ).bind(user.id).run();

    return Response.json({ ok: true });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: 'could not save' }, { status: 500 });
  }
}
