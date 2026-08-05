-- flags a venue for Kar to re-check its map pin. Owners can (eventually)
-- edit a venue's Maps link but never lat/lng directly — the app itself
-- sets this to 1 whenever an owner changes that link, since a new Maps URL
-- may point somewhere slightly different and the pin needs a human to
-- confirm it still matches. Reset to 0 by hand once checked (no UI yet for
-- that either — this is ownership only, step 1 of the venue owner
-- dashboard, see migrations/006_owners.sql).
ALTER TABLE venues ADD COLUMN location_review INTEGER NOT NULL DEFAULT 0;
