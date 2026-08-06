-- pin_status: whether a venue has a Kar-confirmed map location ('placed')
-- or is an owner submission still waiting on that ('pending'). Pending
-- venues have no meaningful lat/lng yet, so this migration also drops the
-- NOT NULL constraint on lat/lng.
--
-- SQLite has no ALTER TABLE for relaxing a column constraint, so this is
-- the standard rebuild: create the new shape, copy every row across
-- (existing venues all become 'placed', keeping their real lat/lng), drop
-- the old table, rename the new one into place. Nothing here changes
-- existing data — every row keeps its own id/lat/lng/etc, only the new
-- column and the relaxed constraint are added.
--
-- Every consumer of lat/lng was audited for a null coordinate before this
-- shipped: functions/api/checkin.js and functions/api/route.js reject
-- before doing distance math on a pending venue; js/app.js's renderMarkers,
-- the boot() bounds-fit loop, venueLine(), and openVenue()'s flyTo all skip
-- or fall back when lat/lng is null. See CLAUDE.md's workflow rules — this
-- migration must run against --remote before any code that reads
-- pin_status or expects a null lat/lng ships.
-- venue_owners.venue_id REFERENCES venues(id) — dropping venues mid-rebuild
-- trips that FK unless enforcement is off for the duration. Restored at the
-- end; the table is only briefly absent within this same script.
PRAGMA foreign_keys = OFF;

CREATE TABLE venues_new (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  short_name        TEXT,
  name_lo           TEXT,
  type              TEXT NOT NULL,
  lat               REAL,
  lng               REAL,
  area              TEXT,
  short             TEXT,
  description       TEXT,
  photos            TEXT,
  hours             TEXT,
  contact           TEXT,
  parking           TEXT,
  links             TEXT,
  verified          INTEGER NOT NULL DEFAULT 0,
  status            TEXT,
  source            TEXT,
  checkin_radius_m  INTEGER,
  updated_at        TEXT NOT NULL,
  location_review   INTEGER NOT NULL DEFAULT 0,
  signature         TEXT,
  pin_status        TEXT NOT NULL DEFAULT 'placed'
);

INSERT INTO venues_new (
  id, name, short_name, name_lo, type, lat, lng, area, short, description,
  photos, hours, contact, parking, links, verified, status, source,
  checkin_radius_m, updated_at, location_review, signature, pin_status
)
SELECT
  id, name, short_name, name_lo, type, lat, lng, area, short, description,
  photos, hours, contact, parking, links, verified, status, source,
  checkin_radius_m, updated_at, location_review, signature, 'placed'
FROM venues;

DROP TABLE venues;
ALTER TABLE venues_new RENAME TO venues;

PRAGMA foreign_keys = ON;
