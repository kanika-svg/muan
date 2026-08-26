-- mood_picks: the app's first analytics table. Logs one row per mood
-- selection from the "ຢາກໄປໃສດີ?" chooser (js/app.js showMoodIntro()) and
-- one row per "Just show me around" dismissal (tag = 'dismissed'), written
-- server-side by POST /api/mood-pick — see that file for what is
-- deliberately NOT recorded (no user id, session id, IP, or device info).
-- Read back via GET /api/mood-stats (admin-gated, functions/api/_admin.js).
CREATE TABLE mood_picks (
  id         INTEGER PRIMARY KEY,
  tag        TEXT NOT NULL,
  picked_at  TEXT NOT NULL,
  time_bucket TEXT NOT NULL,   -- 'day' | 'night', from isNight() (server-side Vientiane time)
  signed_in  INTEGER NOT NULL DEFAULT 0
);
