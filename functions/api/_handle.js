// A handle is a public name people type and read — "@kanika-luangmuninth",
// not "@Kanika luangmuninthone". New accounts used to take the raw Google
// display name verbatim, spaces, capitals and all (see auth/google.js), so
// the You screen showed an @-handle nobody could type, that sorted and
// compared by accident of capitalisation, and that leaked exactly how the
// user had filled in their Google profile.
//
// Also imported by scripts/migrate-handles.js, which rewrites the rows that
// were created before this existed — one definition of the rule, so a
// migrated handle and a freshly-issued one can't be shaped differently.
export const MAX_HANDLE = 20;

// Latin letters are lowercased and stripped of their accents (NFD, then
// drop the U+0300–U+036F combining marks); Lao (U+0E80–U+0EFF) is kept
// as-is, since it is caseless and this app is Lao-first. Everything else —
// spaces, dots, apostrophes, emoji — collapses to a single "-". Returns ''
// for input with nothing usable in it; callers decide the fallback.
export function slugifyHandle(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9຀-໿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_HANDLE)
    .replace(/-+$/, '');   // in case the 20-char cut landed on a separator
}

// appends 2, 3, … to a taken base. The digits eat into the 20-char budget
// rather than overflowing it, and the trailing "-" is re-trimmed after the
// cut so a collision can't produce "kanika-2" as "kanika--2" or the base
// "kanika-luangmuninth" as "kanika-luangmunint-2".
export function numberedHandle(base, n) {
  const room = MAX_HANDLE - String(n).length;
  return (base.slice(0, room).replace(/-+$/, '') || 'friend') + n;
}

// picks a free handle for a new account: the display name, else the email
// prefix, else "friend" — then numbered until users.handle's UNIQUE
// constraint is satisfied. `taken` is an async predicate so the same logic
// serves both the live D1 binding here and the migration script's snapshot.
export async function pickHandle(info, taken) {
  const base = slugifyHandle(info.name)
    || slugifyHandle(info.email ? String(info.email).split('@')[0] : '')
    || 'friend';
  let handle = base;
  let n = 1;
  while (await taken(handle)) {
    n++;
    if (n > 99) return 'friend' + Date.now().toString().slice(-6);
    handle = numberedHandle(base, n);
  }
  return handle;
}
