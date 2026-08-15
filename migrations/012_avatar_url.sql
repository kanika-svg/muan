-- avatar_url: the user's own uploaded profile picture (Cloudinary public ID,
-- "<version>/<publicId>", same format as venue photos — see cloudinaryUrl()
-- in js/app.js). Separate from the chibi avatar, which is a client-only
-- localStorage pick (see 'muan-avatar' in js/app.js) with no server column
-- at all and stays the social representation for comments/friends later.
-- NULL = no photo uploaded, client falls back to the chibi.
ALTER TABLE users ADD COLUMN avatar_url TEXT;
