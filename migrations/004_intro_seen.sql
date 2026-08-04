-- one-time first-sign-in flame explainer card (js/app.js renderFlameIntro());
-- server-side so it doesn't reappear on a new device (see /api/intro-seen)
ALTER TABLE users ADD COLUMN intro_seen INTEGER NOT NULL DEFAULT 0;
