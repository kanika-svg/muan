-- mood_intro_seen: one-time first-open "ຢາກໄປໃສດີ?" full-screen greeting
-- (js/app.js showMoodIntro(), called from boot()) — same server-side
-- pattern as migrations/004_intro_seen.sql's users.intro_seen for the flame
-- explainer. Signed-in only: an anonymous first-time visitor (the common
-- case, since most people haven't signed in yet on their first open) has
-- no users row yet, so that visitor is gated by a localStorage flag
-- instead (see MOOD_INTRO_KEY in js/app.js) — this column only matters for
-- someone who opens the app already signed in, or signs in later and then
-- reinstalls / clears storage.
ALTER TABLE users ADD COLUMN mood_intro_seen INTEGER NOT NULL DEFAULT 0;
