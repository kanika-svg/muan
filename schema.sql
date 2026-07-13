CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  google_sub TEXT UNIQUE NOT NULL,
  handle TEXT UNIQUE NOT NULL,          -- public name, user-chosen
  created_at TEXT NOT NULL,
  ghost INTEGER NOT NULL DEFAULT 0,
  embers_total INTEGER NOT NULL DEFAULT 0,
  streak_months INTEGER NOT NULL DEFAULT 0,
  last_checkin_month TEXT,              -- 'YYYY-MM' for streak logic
  dormant INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE checkins (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  venue_id TEXT NOT NULL,               -- matches venues.json id
  created_at TEXT NOT NULL,             -- ISO UTC
  lat REAL, lng REAL,                   -- as reported, for audit; purge >90d
  embers INTEGER NOT NULL
);
CREATE INDEX idx_checkins_venue_time ON checkins(venue_id, created_at);
CREATE INDEX idx_checkins_user_time  ON checkins(user_id, created_at);

CREATE TABLE badges (
  code TEXT PRIMARY KEY,                -- 'cafe-hunter'
  name TEXT NOT NULL, name_lo TEXT,
  rule TEXT NOT NULL                    -- human-readable; logic lives in Worker
);

CREATE TABLE user_badges (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_code TEXT NOT NULL REFERENCES badges(code),
  earned_at TEXT NOT NULL,
  PRIMARY KEY (user_id, badge_code)
);

CREATE TABLE friendships (
  a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,                 -- 'pending' | 'accepted'
  muted_by_a INTEGER NOT NULL DEFAULT 0,
  muted_by_b INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (a, b)                    -- store with a < b
);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  venue_id TEXT NOT NULL,
  body TEXT NOT NULL,                   -- max 500 chars, enforced in Worker
  created_at TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0     -- moderation flag
);
CREATE INDEX idx_comments_venue ON comments(venue_id, created_at);

CREATE TABLE quests (                   -- monthly quest definitions
  id INTEGER PRIMARY KEY,
  month TEXT NOT NULL,                  -- 'YYYY-MM'
  code TEXT NOT NULL,                   -- 'two-new-places'
  target INTEGER NOT NULL,
  reward_embers INTEGER NOT NULL
);

CREATE TABLE quest_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quest_id INTEGER NOT NULL REFERENCES quests(id),
  progress INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  PRIMARY KEY (user_id, quest_id)
);

CREATE TABLE config (                   -- tunables without redeploy
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);

INSERT INTO config (key, value) VALUES
  ('ember_base', '10'),
  ('ember_new_venue', '25'),
  ('ember_repeat', '5'),
  ('ember_event', '5'),
  ('ember_friend', '5'),
  ('checkin_radius_m', '150'),
  ('phai_thresholds', '[0,100,400,1200,3000]');
