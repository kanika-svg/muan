export async function getSessionUser(context) {
  const cookie = context.request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)psd_session=([A-Za-z0-9-]+)/);
  if (!m) return null;
  const row = await context.env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`
  ).bind(m[1], new Date().toISOString()).first();
  return row || null;
}

export function sessionCookie(token, maxAgeSeconds) {
  return `psd_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}
