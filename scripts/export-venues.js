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
  "Kar-set only. Omitted/null = not yet tagged.";

// single line, no embedded newlines — execSync below runs this through the
// platform shell (cmd.exe on Windows) as one quoted --command token, and a
// multi-line value doesn't survive that quoting intact
const QUERY = "SELECT id, name, short_name, name_lo, type, lat, lng, area, short, description, photos, hours, hours_note, contact, parking, links, verified, status, source, signature, pin_status, vibe FROM venues ORDER BY rowid;";

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
