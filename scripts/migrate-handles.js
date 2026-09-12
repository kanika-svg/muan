#!/usr/bin/env node
// Rewrites existing users.handle values into the slug shape new accounts
// have got since functions/api/_handle.js landed (lowercase, no spaces,
// Latin accents folded, Lao kept). Before that, a new account took the raw
// Google display name verbatim — "Kanika luangmuninthone" — which is not a
// handle anyone can type.
//
//   node scripts/migrate-handles.js            # dry run: prints the plan
//   node scripts/migrate-handles.js --apply    # writes it
//   node scripts/migrate-handles.js --local    # against the local D1, either mode
//
// Deliberately NOT a migrations/*.sql file. Three things this has to do
// that SQLite cannot:
//   - lower() in SQLite only folds ASCII, so a name with any accented
//     letter would come out half-cased;
//   - users.handle is UNIQUE, so two rows slugifying to the same value
//     (say "Kar Sy" and "kar-sy") would abort the whole statement —
//     numbering the loser has to happen row by row, against the handles
//     already taken by rows this run has not reached yet;
//   - it has to be re-runnable, since a row already in slug shape must not
//     be touched (rewriting a handle a second time would hand out a new
//     public name to someone who already has one).
// It is also not on the migrations ladder for a reason: CLAUDE.md's rule is
// that code must not ship ahead of its migration, and nothing here is a
// schema change — the column already exists and the app reads whatever is
// in it. Running this late only leaves old handles looking old.
//
// Requires the wrangler CLI authenticated against this project's Cloudflare
// account, same as scripts/export-venues.js and check-schema.js.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { pathToFileURL } = require('url');

const DB_NAME = 'muan-db';
const APPLY = process.argv.includes('--apply');
const LOCAL = process.argv.includes('--local');

const target = () => (LOCAL ? '--local' : '--remote');
const run = (args) =>
  execSync(`npx wrangler d1 execute ${DB_NAME} ${target()} --json ${args}`,
    { cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

// reads go through --command, same shape as scripts/export-venues.js and
// check-schema.js: one double-quoted token, no embedded newlines. Only ever
// called with ASCII SQL here.
function d1Read(sql) {
  return JSON.parse(run(`--command "${sql}"`))[0].results;
}

// writes go through a UTF-8 --file instead, NOT --command. A slugified
// handle can be Lao (see slugifyHandle() — Lao is caseless and kept as-is),
// and pushing non-ASCII through cmd.exe's active code page is how you end up
// silently renaming someone to mojibake. A file has no code page.
function d1Write(sql) {
  const file = path.join(os.tmpdir(), `muan-handles-${Date.now()}.sql`);
  fs.writeFileSync(file, sql, 'utf8');
  try { run(`--file "${file}"`); } finally { fs.unlinkSync(file); }
}

// a SQL string literal. Handles reaching here are slug-shaped, so the quote
// doubling is belt-and-braces rather than the only thing standing between
// this and an injection.
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

(async () => {
  const { slugifyHandle, numberedHandle } = await import(
    pathToFileURL(path.join(__dirname, '..', 'functions', 'api', '_handle.js')).href
  );

  const users = d1Read('SELECT id, handle FROM users ORDER BY id');
  if (!users.length) { console.log('No users.'); return; }

  // every handle currently in the table, so a rewrite can never collide
  // with a row that this run has not reached yet
  const taken = new Set(users.map((u) => u.handle));
  const plan = [];

  for (const u of users) {
    const base = slugifyHandle(u.handle) || 'friend';
    if (base === u.handle) continue;          // already slug-shaped, leave alone
    taken.delete(u.handle);                   // this row's own old handle frees up
    let next = base, n = 1;
    while (taken.has(next)) {
      n++;
      next = n > 99 ? 'friend' + String(u.id) : numberedHandle(base, n);
      if (n > 99) break;
    }
    taken.add(next);
    plan.push({ id: u.id, from: u.handle, to: next });
  }

  const where = LOCAL ? 'local' : 'PRODUCTION';
  console.log(`${users.length} user(s) in ${where} D1; ${plan.length} need rewriting.\n`);
  for (const p of plan) console.log(`  #${p.id}  ${JSON.stringify(p.from)}  ->  @${p.to}`);
  if (!plan.length) return;

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply to write these.');
    return;
  }

  // one statement per row in a single file: D1 runs them as one batch, so a
  // UNIQUE violation anywhere rolls the whole set back rather than leaving
  // half the users renamed
  d1Write(plan.map((p) => `UPDATE users SET handle=${q(p.to)} WHERE id=${p.id};`).join('\n'));
  console.log(`\nRewrote ${plan.length} handle(s) in ${where} D1.`);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
