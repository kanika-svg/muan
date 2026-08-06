-- signature items: up to 3 "try this" highlights an owner can list per venue
-- (CLAUDE.md: name required, price/note optional — this is not a menu).
-- JSON array column, nullable — NULL means the venue sheet's "Try this"
-- block is skipped entirely rather than shown empty.
ALTER TABLE venues ADD COLUMN signature TEXT;
