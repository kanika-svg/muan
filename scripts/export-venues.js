#!/usr/bin/env node
// D1 `venues` table -> data/venues.json. The reverse of import-venues.js:
// venues.json is now a MIRROR of D1, not the source of truth (see
// migrations/005_venues.sql, functions/api/venues.js). Run this after any
// D1 edit so the repo keeps a human-readable, diffable history of what
// changed — a database you can't read is harder to trust than a file you
// can.
//
//   node scripts/export-venues.js
//
// Read-only: runs one SELECT against the live D1 database via `wrangler d1
// execute --remote` and overwrites data/venues.json. Safe to run any time;
// makes no writes to D1. Requires the wrangler CLI authenticated against
// this project's Cloudflare account (same as import-venues.js).
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// not stored in D1 — this is documentation about the mirror file's format,
// not venue data, so it's authored here rather than round-tripped through
// the database. Update by hand if the format/conventions below change.
const SCHEMA_NOTES =
  "Coordinates and hours sourced from live Google Maps listings on 2026-07-11. " +
  "Google hours can lag reality — spot-check in person when convenient. " +
  "hours: 24h 'HH:MM-HH:MM' per day, null = closed that day. Whole hours " +
  "object null = hours unknown/unconfirmed. Closing past midnight: 02:00 am " +
  "= '26:00', 03:00 am = '27:00'. hours_note: shown instead of 'hours " +
  "unconfirmed' when hours is null but there's a known reason (e.g. a venue " +
  "with no daily schedule) rather than nobody having looked — only read " +
  "when hours is null. " +
  "photos (and events.json's photo field): '<version>/<publicId>', e.g. " +
  "'v1785599071/anfront_ycq5p6' — a Cloudinary public ID, not a full URL. " +
  "See cloudinaryUrl() in js/app.js, the only place that turns this into a " +
  "delivery URL (cloud name + q_auto,f_auto,dpr_auto + width live there, " +
  "not in the stored value). " +
  "vibe: 0-4 tags from a fixed vocabulary (under-trees, tucked-away, " +
  "for-coffee, settle-in — see VIBE_TAGS in functions/api/_venue-validation.js), " +
  "Kar-set only. Omitted/null = not yet tagged. " +
  "outdoor: true = exposed to the weather (rooftop, open-air, riverside, " +
  "garden/courtyard with nowhere indoors to sit it out), false = indoors " +
  "enough that rain doesn't change the plan. Kar-set only. OMITTED = not " +
  "yet audited, which is not the same as false: the rain note on a card is " +
  "shown only for true and skipped entirely when the field is absent, so an " +
  "unchecked venue never claims either way. See migrations/016_outdoor.sql. " +
  "Optional \"why\": a short Kar-written paragraph on who the place suits, " +
  "shown as 'Why you'll like it' on the venue detail; omitted = not written " +
  "yet, and the block does not render. Optional \"rating\" (1-5) and " +
  "\"review_count\": Paisaidee's OWN reviews only, set together, rating shown " +
  "only when review_count > 0 — never a Google or aggregator rating. All three " +
  "Kar-set only. See migrations/017_why_rating.sql. " +
  "Optional \"logo\": the venue's own mark, a Cloudinary public ID in the " +
  "same '<version>/<publicId>' form as photos. Used ONLY in the venue " +
  "detail header, as a circular badge; list cards, the carousel and the map " +
  "keep using photos[0], since a logo says which place it is and a photo " +
  "says what it looks like. Omitted = no logo, and no circle is drawn at " +
  "all — there is no placeholder or initial. Kar-set only, and not every " +
  "mark belongs here: a photograph of a sign on a wall is a photo, not a " +
  "logo, and crops badly into a circle. See migrations/018_logo.sql.";

// single line, no embedded newlines — execSync below runs this through the
// platform shell (cmd.exe on Windows) as one quoted --command token, and a
// multi-line value doesn't survive that quoting intact
const QUERY = "SELECT id, name, short_name, name_lo, type, lat, lng, area, short, description, photos, hours, hours_note, contact, parking, links, verified, status, source, signature, pin_status, vibe, outdoor, why, rating, review_count, logo FROM venues ORDER BY rowid;";

// mirrors functions/api/venues.js's row -> JSON reassembly exactly; if that
// shape ever changes, change it there and here together
function rowToVenue(r) {
  const v = {
    id: r.id,
    name: r.name,
    short_name: r.short_name,
    name_lo: r.name_lo,
    type: r.type,
    lat: r.lat,
    lng: r.lng,
    area: r.area,
    short: r.short,
    description: r.description,
    photos: JSON.parse(r.photos || '[]'),
    hours: r.hours ? JSON.parse(r.hours) : null,
    hours_note: r.hours_note,
    links: r.links ? JSON.parse(r.links) : {},
    verified: !!r.verified,
    source: r.source,
    pin_status: r.pin_status,
  };
  if (r.contact !== null) v.contact = JSON.parse(r.contact);
  if (r.parking !== null) v.parking = JSON.parse(r.parking);
  if (r.status !== null) v.status = r.status;
  if (r.signature !== null) v.signature = JSON.parse(r.signature);
  if (r.vibe !== null) v.vibe = JSON.parse(r.vibe);
  // omitted when NULL, boolean when set — same absence-carries-the-third-
  // state convention functions/api/venues.js uses, which this function has
  // to mirror exactly (see the note above rowToVenue)
  if (r.outdoor !== null) v.outdoor = !!r.outdoor;
  // migrations/017_why_rating.sql — omitted when NULL, mirroring
  // functions/api/venues.js exactly
  if (r.why !== null) v.why = r.why;
  if (r.rating !== null) v.rating = r.rating;
  if (r.review_count !== null) v.review_count = r.review_count;
  // migrations/018_logo.sql — omitted when NULL, mirroring
  // functions/api/venues.js exactly
  if (r.logo !== null) v.logo = r.logo;
  return v;
}

function main() {
  const cmd = `npx wrangler d1 execute muan-db --remote --json --command "${QUERY.replace(/"/g, '\\"')}"`;
  const raw = execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const parsed = JSON.parse(raw);
  const rows = parsed[0].results;

  const venues = rows.map(rowToVenue);
  const output = { _schema_notes: SCHEMA_NOTES, venues };

  const venuesPath = path.join(__dirname, '..', 'data', 'venues.json');
  fs.writeFileSync(venuesPath, JSON.stringify(output, null, 2) + '\n');

  console.log(`Exported ${venues.length} venues from D1 to ${venuesPath}`);
}

main();
