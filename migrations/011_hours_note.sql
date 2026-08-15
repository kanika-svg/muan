-- hours_note: a short freeform explanation shown instead of "hours
-- unconfirmed" when hours is NULL for a reason we actually know (e.g. an
-- exhibition centre that has no daily schedule and only opens for events)
-- rather than because nobody has looked yet. Purely cosmetic — see
-- openStatus() in js/app.js, which reads it only when hours is NULL.
-- isVenueOpen() in functions/api/checkin.js is untouched: NULL hours still
-- means always-open for check-in purposes, hours_note or not.
ALTER TABLE venues ADD COLUMN hours_note TEXT;
