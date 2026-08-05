#!/usr/bin/env node
// One-time import: data/venues.json -> D1 `venues` table (see
// migrations/005_venues.sql). Generates a SQL file rather than writing
// directly, so the statements can be reviewed before running against the
// real database:
//
//   node scripts/import-venues.js > /tmp/import-venues.sql
//   wrangler d1 execute muan-db --remote --file=/tmp/import-venues.sql
//
// Safe to re-run: every row is `INSERT OR REPLACE`, keyed on id, so running
// this again after an edit to venues.json re-syncs D1 to match the file.
const fs = require('fs');
const path = require('path');

const venuesPath = path.join(__dirname, '..', 'data', 'venues.json');
const { venues } = JSON.parse(fs.readFileSync(venuesPath, 'utf8'));

// SQL string literal escaping — single quotes only; these values never
// reach D1 through string concatenation at request time (only this one-off
// import script does this), so this is not the injection-risk pattern it
// would be in a live API handler.
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sqlVal = (v) => (v === undefined || v === null ? 'NULL' : sqlStr(v));
const sqlJson = (v) => (v === undefined || v === null ? 'NULL' : sqlStr(JSON.stringify(v)));

const importedAt = new Date().toISOString();

const rows = venues.map((v) => {
  const cols = [
    'id', 'name', 'short_name', 'name_lo', 'type', 'lat', 'lng', 'area',
    'short', 'description', 'photos', 'hours', 'contact', 'parking',
    'links', 'verified', 'status', 'source', 'updated_at',
  ];
  const vals = [
    sqlVal(v.id),
    sqlVal(v.name),
    sqlVal(v.short_name),
    sqlVal(v.name_lo),
    sqlVal(v.type),
    v.lat,
    v.lng,
    sqlVal(v.area),
    sqlVal(v.short),
    sqlVal(v.description),
    sqlJson(v.photos ?? []),
    sqlJson(v.hours),
    sqlJson(v.contact),
    sqlJson(v.parking),
    sqlJson(v.links),
    v.verified ? 1 : 0,
    sqlVal(v.status),
    sqlVal(v.source),
    sqlStr(importedAt),
  ];
  return `INSERT OR REPLACE INTO venues (${cols.join(', ')}) VALUES (${vals.join(', ')});`;
});

console.log(rows.join('\n'));
