#!/usr/bin/env node
// Compares the schema schema.sql + migrations/*.sql say production D1
// SHOULD have against what it actually has, and exits non-zero if a
// migration was written but never run with --remote.
//
// Written after migration 010 (rejection_reason) shipped and broke
// /api/my-venues for every owner — the second time this exact class of bug
// has happened (see migration 008's outage, documented in CLAUDE.md). Both
// times the rule was "remember to run `wrangler d1 execute --remote
// --command=PRAGMA table_info(...)` by hand before pushing." A rule that
// has to be remembered is the thing that failed twice; this is the check
// that doesn't rely on that. See CLAUDE.md for when to run this, and
// scripts/check-schema.js's own header for how it can run automatically in
// the Cloudflare Pages build instead.
//
//   node scripts/check-schema.js
//
// Read-only: one `wrangler d1 execute --remote` call, batching a
// PRAGMA table_info(<table>) per table onto a single --command (D1/SQLite
// runs semicolon-separated statements as a batch, wrangler --json returns
// one result set per statement) — cheaper than one subprocess per table.
// Makes no writes. Requires the wrangler CLI authenticated against this
// project's Cloudflare account, same as scripts/export-venues.js.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_NAME = 'muan-db';

// ---------- parse the schema every migration file SHOULD have produced ----------

function stripLineComments(sql) {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

// splits a CREATE TABLE body on top-level commas only — doesn't get fooled
// by the commas inside e.g. "PRIMARY KEY (user_id, venue_id)" or
// "REFERENCES users(id)"
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

const TABLE_CONSTRAINT = /^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i;

function columnsFromCreateBody(body) {
  const cols = [];
  for (const raw of splitTopLevel(body)) {
    const clause = raw.trim();
    if (!clause || TABLE_CONSTRAINT.test(clause)) continue;
    const m = clause.match(/^"?([A-Za-z_][A-Za-z0-9_]*)"?/);
    if (m) cols.push(m[1]);
  }
  return cols;
}

// returns the index just past the "(" at `openAt`'s matching ")"
function matchParenEnd(sql, openAt) {
  let depth = 0;
  for (let i = openAt; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error(`unbalanced parentheses at index ${openAt}`);
}

const CREATE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(/gi;
const ALTER_ADD_RE = /ALTER\s+TABLE\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+ADD\s+COLUMN\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/gi;
const ALTER_RENAME_RE = /ALTER\s+TABLE\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+RENAME\s+TO\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/gi;
const DROP_RE = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi;

// applies one file's CREATE/ALTER/DROP/RENAME statements to `schema`
// (table name -> Set of column names) in source order — order matters:
// migrations/009_pin_status.sql creates venues_new, drops the old venues,
// then renames venues_new -> venues, and that has to leave "venues" holding
// the NEW column set, not the old one. A single combined pass sorted by
// match position keeps CREATE/DROP/RENAME interleaved the way they
// actually run, instead of e.g. applying every CREATE before any DROP
// regardless of where each appears in the file.
function applyStatements(sql, schema, fileLabel) {
  const clean = stripLineComments(sql);
  const events = [];
  let m;

  while ((m = CREATE_RE.exec(clean))) {
    const openAt = m.index + m[0].length - 1; // index of the "("
    const closeAt = matchParenEnd(clean, openAt);
    const body = clean.slice(openAt + 1, closeAt - 1);
    events.push({ at: m.index, type: 'create', name: m[1], columns: columnsFromCreateBody(body) });
  }
  while ((m = ALTER_ADD_RE.exec(clean))) {
    events.push({ at: m.index, type: 'add', name: m[1], column: m[2] });
  }
  while ((m = ALTER_RENAME_RE.exec(clean))) {
    events.push({ at: m.index, type: 'rename', from: m[1], to: m[2] });
  }
  while ((m = DROP_RE.exec(clean))) {
    events.push({ at: m.index, type: 'drop', name: m[1] });
  }
  events.sort((a, b) => a.at - b.at);

  for (const ev of events) {
    if (ev.type === 'create') {
      schema.set(ev.name, new Set(ev.columns));
    } else if (ev.type === 'add') {
      if (!schema.has(ev.name)) {
        console.warn(`  note: ${fileLabel} adds a column to "${ev.name}", which no earlier file CREATEd — tracking it anyway`);
        schema.set(ev.name, new Set());
      }
      schema.get(ev.name).add(ev.column);
    } else if (ev.type === 'rename') {
      const cols = schema.get(ev.from);
      if (cols) {
        schema.set(ev.to, cols);
        schema.delete(ev.from);
      }
    } else if (ev.type === 'drop') {
      schema.delete(ev.name);
    }
  }
}

function expectedSchema() {
  const schema = new Map();
  const files = [
    { file: path.join(ROOT, 'schema.sql'), label: 'schema.sql' },
    ...fs
      .readdirSync(path.join(ROOT, 'migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort() // zero-padded numeric prefixes (002, 003, ... 010) sort correctly as strings
      .map((f) => ({ file: path.join(ROOT, 'migrations', f), label: `migrations/${f}` })),
  ];
  for (const { file, label } of files) {
    applyStatements(fs.readFileSync(file, 'utf8'), schema, label);
  }
  return schema;
}

// ---------- query production D1 for the real schema ----------

function actualSchema(tables) {
  const batched = tables.map((t) => `PRAGMA table_info(${t})`).join('; ');
  const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --json --command "${batched}"`;
  const raw = execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const parsed = JSON.parse(raw);
  const map = new Map();
  tables.forEach((t, i) => {
    const rows = parsed[i]?.results || [];
    map.set(t, new Set(rows.map((r) => r.name)));
  });
  return map;
}

// ---------- compare and report ----------

function main() {
  const expected = expectedSchema();
  const tables = [...expected.keys()];

  console.log(`Checking ${tables.length} table(s) from schema.sql + migrations/ against production D1 (${DB_NAME})...\n`);

  let actual;
  try {
    actual = actualSchema(tables);
  } catch (e) {
    console.error('Could not query production D1 — is wrangler authenticated?');
    console.error(e.message);
    process.exit(1);
  }

  let mismatched = false;
  for (const [table, expectedCols] of expected) {
    const actualCols = actual.get(table) || new Set();
    if (actualCols.size === 0) {
      console.error(`✗ ${table}: table does not exist in production`);
      mismatched = true;
      continue;
    }
    const missing = [...expectedCols].filter((c) => !actualCols.has(c));
    if (missing.length) {
      console.error(`✗ ${table}: production is missing column(s): ${missing.join(', ')}`);
      mismatched = true;
    } else {
      console.log(`✓ ${table}: ok (${expectedCols.size} columns)`);
    }
  }

  if (mismatched) {
    console.error('\nSchema mismatch — some migration was written but never run with --remote.');
    console.error('Run the missing CREATE TABLE / ALTER TABLE statements against production (see the migration file) before deploying code that depends on them.');
    process.exit(1);
  }
  console.log('\nSchema OK — production matches every migration.');
}

main();
