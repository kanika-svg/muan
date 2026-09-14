-- NOT A MIGRATION. Do not move this file into migrations/.
--
-- Events are not in D1. data/events.json is the source of truth for them
-- (CLAUDE.md, Architecture notes) and the `repeat` field added on 2026-09-14
-- is a change to THAT file's shape, not to the database — see
-- data/events.json's _repeat_notes and eventDate() in js/app.js. Nothing
-- below has been run, against --remote or anywhere else.
--
-- Why it is parked here instead of in migrations/ as 017_:
-- scripts/check-schema.js reads schema.sql + every migrations/*.sql, works
-- out what production D1 should contain, and exits non-zero if anything is
-- missing. A migration for a table production does not have would therefore
-- fail that check on every future run and block every deploy, including ones
-- that touch nothing but CSS. The script is the guard that exists because
-- migrations 008 and 010 shipped ahead of being run; feeding it a migration
-- that can never pass would train whoever hits it to ignore it, which costs
-- more than the file is worth.
--
-- This is what the change WOULD be if events ever move into D1. It is a
-- sketch of a table that has not been designed — the columns below are the
-- fields data/events.json already carries, nothing more. Treat it as a
-- starting point to argue with, not a plan that has been agreed.

CREATE TABLE events (
  id            TEXT PRIMARY KEY,
  venue_id      TEXT REFERENCES venues(id),   -- NULL: an event with no pinned venue
  title         TEXT NOT NULL,
  title_lo      TEXT,
  date          TEXT NOT NULL,                -- YYYY-MM-DD. The occurrence source_url
                                              -- verified. Never rewritten by repeat.
  start_time    TEXT,                         -- HH:MM, NULL = unknown (never guessed)
  price         INTEGER,                      -- 0 = free, NULL = unknown
  short         TEXT,
  photo         TEXT,
  source_url    TEXT NOT NULL,
  verified      INTEGER NOT NULL DEFAULT 0,

  -- the repeat field, as the JSON carries it. Two columns rather than one
  -- JSON blob so "which fixtures run on a Thursday" and "which repeats have
  -- expired" are both queryable, and so repeat_until can be NOT-NULL-checked
  -- in a review query.
  --   repeat_weekly  comma-separated day codes, lowest first, e.g. 'fri,sat,sun'.
  --                  NULL or '' = does not repeat; `date` is the only date.
  --   repeat_until   YYYY-MM-DD of the last occurrence, or NULL for
  --                  open-ended. NULL is a claim about the future that
  --                  nothing in the database can keep true — see the warning
  --                  in data/events.json's _repeat_notes before relying on it.
  repeat_weekly TEXT,
  repeat_until  TEXT
);

-- If instead events stay in JSON and only the venues table ever needs to
-- know about them, nothing here applies and this file should be deleted.
