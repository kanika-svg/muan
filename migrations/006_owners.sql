-- venue ownership grants — who can (eventually) edit a venue's listing.
-- Many-to-many: a venue can have several owners, a user can own several
-- venues. No self-service claim flow yet (step 1 is ownership only, no UI,
-- no editing) — rows are granted by hand, see the wrangler command noted
-- alongside this migration's rollout.
CREATE TABLE venue_owners (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  venue_id   TEXT NOT NULL REFERENCES venues(id),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, venue_id)
);
