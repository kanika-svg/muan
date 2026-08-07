-- rejection_reason: set by Kar's admin review page (functions/api/venues/
-- [id]/reject.js) when a pending owner submission is turned down. pin_status
-- becomes 'rejected' — a free-text column (see migrations/009_pin_status.sql),
-- no CHECK constraint, so no schema change needed for the new value itself,
-- just somewhere to store why. The row is never deleted on rejection so the
-- owner can still see it (via /api/my-venues -> "Manage your venue") and fix
-- it — see functions/api/venues.js, which excludes 'rejected' venues from
-- the public /api/venues feed but /api/my-venues stays unfiltered.
ALTER TABLE venues ADD COLUMN rejection_reason TEXT;
