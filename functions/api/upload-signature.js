import { getSessionUser } from './_auth.js';

// POST /api/upload-signature — issues a signed Cloudinary upload for one
// venue's photo, scoped to that venue's own folder. Signed rather than an
// unsigned preset: an unsigned preset name is public the moment anyone sees
// it in a network tab, and would let anyone upload to this Cloudinary
// account. The API secret used to sign never reaches the client — only the
// resulting signature, timestamp and api_key do.
//
// The signed params (folder, allowed_formats, max_file_size, timestamp) are
// what actually enforce "images only, max 8MB, in this venue's folder" —
// Cloudinary rejects the upload if the client sends anything other than
// exactly these values, since changing any of them invalidates the
// signature. functions/api/venues/[id].js's validatePhotos() then checks,
// at save time, that any new photo URL actually lives in that folder.
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
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
    const venueId = body && typeof body.venue_id === 'string' ? body.venue_id : '';
    if (!venueId) return Response.json({ ok: false, error: 'missing venue_id' }, { status: 400 });

    const db = context.env.DB;
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

    const cloudName = context.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = context.env.CLOUDINARY_API_KEY;
    const apiSecret = context.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) {
      console.error('Cloudinary env vars not configured (CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET)');
      return Response.json({ ok: false, error: 'upload not configured' }, { status: 500 });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const folder = `paisaidee/venues/${venueId}`;

    // Cloudinary's signing rule: every param going to the upload call except
    // file/api_key/signature/resource_type, sorted alphabetically by key,
    // joined as key=value&..., with the api secret appended before hashing.
    const paramsToSign = {
      allowed_formats: ALLOWED_FORMATS,
      folder,
      max_file_size: String(MAX_PHOTO_BYTES),
      timestamp: String(timestamp),
    };
    const toSign = Object.keys(paramsToSign).sort().map((k) => `${k}=${paramsToSign[k]}`).join('&');
    const signature = await sha1Hex(toSign + apiSecret);

    return Response.json({
      ok: true,
      cloud_name: cloudName,
      api_key: apiKey,
      timestamp,
      folder,
      allowed_formats: ALLOWED_FORMATS,
      max_file_size: MAX_PHOTO_BYTES,
      signature,
    });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: 'signature failed' }, { status: 500 });
  }
}
