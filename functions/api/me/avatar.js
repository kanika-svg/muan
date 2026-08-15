import { getSessionUser } from '../_auth.js';

// POST /api/me/avatar — save (or clear) the signed-in user's own profile
// picture. Body: { public_id: "<version>/<publicId>" } from a signed
// upload (see /api/upload-signature's { target: 'avatar' } branch), or
// { public_id: null } to remove the photo and fall back to the chibi.
//
// isOwnAvatarPublicId mirrors functions/api/venues/[id].js's
// isOwnedPublicId(): a client can't set someone else's photo on their own
// account, because the value has to point into THIS user's own upload
// folder (paisaidee/users/<user_id>/), which only a signed upload issued
// for this exact session could have produced.
function isOwnAvatarPublicId(stored, cloudName, userId) {
  if (typeof stored !== 'string' || !cloudName) return false;
  const escapedId = String(userId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^v\\d+/paisaidee/users/${escapedId}/[A-Za-z0-9_-]+$`);
  return re.test(stored);
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405 });
  }

  try {
    const user = await getSessionUser(context);
    if (!user) return Response.json({ ok: false, need_auth: true }, { status: 401 });

    const body = await context.request.json().catch(() => null);
    if (!body || typeof body !== 'object' || !('public_id' in body)) {
      return Response.json({ ok: false, error: 'missing public_id' }, { status: 400 });
    }

    let avatarUrl = null;
    if (body.public_id !== null) {
      if (!isOwnAvatarPublicId(body.public_id, context.env.CLOUDINARY_CLOUD_NAME, user.id)) {
        return Response.json({ ok: false, error: 'that photo was not uploaded for this account' }, { status: 400 });
      }
      avatarUrl = body.public_id;
    }

    await context.env.DB.prepare('UPDATE users SET avatar_url = ? WHERE id = ?')
      .bind(avatarUrl, user.id).run();

    return Response.json({ ok: true, avatar_url: avatarUrl });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: 'save failed' }, { status: 500 });
  }
}
