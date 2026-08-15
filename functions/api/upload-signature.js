import { getSessionUser } from './_auth.js';

// POST /api/upload-signature — issues a signed Cloudinary upload, scoped to
// either one venue's own folder (default) or the signed-in user's own
// avatar folder ({ target: 'avatar' } — see js/app.js's profile-picture
// upload). Signed rather than an unsigned preset: an unsigned preset name
// is public the moment anyone sees it in a network tab, and would let
// anyone upload to this Cloudinary account. The API secret used to sign
// never reaches the client — only the resulting signature, timestamp and
// api_key do.
//
// The signed params (folder, allowed_formats, timestamp) are what actually
// enforce "images only, in this venue's folder" — Cloudinary rejects the
// upload if the client sends anything other than exactly these values,
// since changing any of them invalidates the signature.
// functions/api/venues/[id].js's validatePhotos() then checks, at save
// time, that any new photo URL actually lives in that folder.
//
// max_file_size is NOT in this list on purpose, after shipping broken: it
// is not a documented parameter of Cloudinary's raw /image/upload API (only
// of upload presets and the JS Upload Widget, neither of which this uses),
// so Cloudinary silently drops it when computing its own "string to sign"
// — see the "Invalid Signature" incident this comment was added for. Signing
// a param Cloudinary itself won't include is an unrecoverable mismatch, no
// matter what the client sends alongside it. The practical effect: file
// size is currently only checked client-side (see MAX_PHOTO_BYTES in
// js/app.js, `file.size > MAX_PHOTO_BYTES`), which is a UX guard, not a
// security boundary — a modified client can bypass it. Real server-side
// enforcement would need either a Cloudinary upload preset with
// max_file_size configured (dashboard/Admin API, not this file) or a
// post-upload size check that deletes an oversized asset; neither is
// implemented here.
const MAX_PHOTOS = 8;
const ALLOWED_FORMATS = 'jpg,jpeg,png,webp,heic,heif';

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha1Hex(message) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(message));
  return toHex(digest);
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405 });
  }

  try {
    const user = await getSessionUser(context);
    if (!user) return Response.json({ ok: false, need_auth: true }, { status: 401 });

    const body = await context.request.json().catch(() => null);
    const forAvatar = body && body.target === 'avatar';

    const db = context.env.DB;
    let folder;
    if (forAvatar) {
      // one photo, no per-venue ownership check needed — every signed-in
      // user owns exactly their own folder, checked by user.id alone
      folder = `paisaidee/users/${user.id}`;
    } else {
      const venueId = body && typeof body.venue_id === 'string' ? body.venue_id : '';
      if (!venueId) return Response.json({ ok: false, error: 'missing venue_id' }, { status: 400 });

      const owns = await db.prepare(
        'SELECT 1 FROM venue_owners WHERE user_id = ? AND venue_id = ?'
      ).bind(user.id, venueId).first();
      if (!owns) return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });

      const venue = await db.prepare('SELECT photos FROM venues WHERE id = ?').bind(venueId).first();
      if (!venue) return Response.json({ ok: false, error: 'not found' }, { status: 404 });

      const currentCount = JSON.parse(venue.photos || '[]').length;
      if (currentCount >= MAX_PHOTOS) {
        return Response.json({ ok: false, error: `up to ${MAX_PHOTOS} photos per venue` }, { status: 400 });
      }
      folder = `paisaidee/venues/${venueId}`;
    }

    const cloudName = context.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = context.env.CLOUDINARY_API_KEY;
    const apiSecret = context.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) {
      console.error('Cloudinary env vars not configured (CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET)');
      return Response.json({ ok: false, error: 'upload not configured' }, { status: 500 });
    }

    const timestamp = Math.floor(Date.now() / 1000);

    // Cloudinary's signing rule: every param going to the upload call except
    // file/api_key/signature/resource_type, sorted alphabetically by key,
    // joined as key=value&..., with the api secret appended before hashing.
    const paramsToSign = {
      allowed_formats: ALLOWED_FORMATS,
      folder,
      timestamp: String(timestamp),
    };
    const toSign = Object.keys(paramsToSign).sort().map((k) => `${k}=${paramsToSign[k]}`).join('&');
    const signature = await sha1Hex(toSign + apiSecret);

    // params is the single source of truth for what got signed — the
    // client (js/app.js wireVenuePhotoUpload) sends exactly these key/value
    // pairs back plus file/api_key/signature, rather than reconstructing
    // its own list, so the two can never drift out of sync again the way
    // max_file_size did above.
    return Response.json({
      ok: true,
      cloud_name: cloudName,
      api_key: apiKey,
      signature,
      params: paramsToSign,
    });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: 'signature failed' }, { status: 500 });
  }
}
