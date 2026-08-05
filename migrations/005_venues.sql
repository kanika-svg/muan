-- venues: single source of truth, replacing data/venues.json as the live
-- read (see /api/venues) and functions/api/checkin.js's hardcoded
-- VENUE_COORDS/VENUE_HOURS tables (not yet switched over — see PLAN.md
-- discussion; this migration only adds the table, nothing reads it yet).
--
-- photos is a JSON array column, not a separate table — revisit only if an
-- editing UI needs single-photo add/remove without rewriting the array.
-- hours/contact/parking/links are JSON objects for the same reason: always
-- read/written as one unit, never queried field-by-field.
--
-- checkin_radius_m exists so a future per-venue check-in radius override
-- doesn't need another migration, but it is NOT wired into checkin.js in
-- this pass — this migration does one thing.
CREATE TABLE IF NOT EXISTS venues (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  short_name        TEXT,
  name_lo           TEXT,
  type              TEXT NOT NULL,
  lat               REAL NOT NULL,
  lng               REAL NOT NULL,
  area              TEXT,
  short             TEXT,
  description       TEXT,
  photos            TEXT,              -- JSON array of URLs, '[]' if none
  hours             TEXT,              -- JSON object, NULL = hours unconfirmed
  contact           TEXT,              -- JSON object, NULL if not sourced
  parking           TEXT,              -- JSON object, NULL if not sourced
  links             TEXT,              -- JSON object: {facebook, maps, website}
  verified          INTEGER NOT NULL DEFAULT 0,
  status            TEXT,              -- e.g. 'opening-soon'; NULL = normal
  source            TEXT,
  checkin_radius_m  INTEGER,           -- unused this pass, see note above
  updated_at        TEXT NOT NULL
);
