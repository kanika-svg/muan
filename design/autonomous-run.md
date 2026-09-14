# Autonomous run — 2026-09-13

Kar: unattended session, worked through the task list in order. **Nothing is
committed and nothing is pushed.** Everything below is in the working tree.
No migration was run against `--remote`. No venue data was added, edited or
invented; `data/venues.json`, `data/events.json`, `data/picks.json`,
`migrations/` and `functions/` are untouched — check `git status`.

```
 M css/style.css      47 hunks
 M index.html          1 hunk
 M js/app.js          19 hunks
?? js/owner.js        (new — code moved out of app.js, see C)
?? js/avatar.js       (new — code moved out of app.js, see C)
?? data/candidates.json  (new — staging only, nothing loads it)
?? design/autonomous-run.md
```

**Read these four first, they are the ones where I made a judgement you might
reverse:**

1. `--flame-text` — a new day-theme token. Flame text on cream measured
   3.21–3.87:1 everywhere it was used, including the owner form's error
   lines. This darkens flame-as-text on day only. Brand-adjacent. §A2.
2. `.card.closed` fade `.82 → .92`. Nearly invisible now. The alternative is
   dropping the fade entirely, which I did not do unilaterally. §A3.
3. Third-party stylesheets in `index.html` are no longer render-blocking.
   Can cause a frame of fallback type. Revert is two lines. §C2.
4. The Lao on the owner forms is **mine and unchecked**. Fourteen new
   `eg_lo` lines of real prose, not just labels. §D1.

---

## A. Correctness audit

### A1 — hardcoded colour literals that should be tokens

Found and fixed:

| where | was | now | why it mattered |
|---|---|---|---|
| `.chip.on`, `.btn-go`, `.cel-done`, `.fl-invite-btn`, `.ed-photo-confirm-yes` | `color: var(--ink)` on a flame fill | `var(--on-flame)` | `--ink` is the page ground and flips to cream on day, so every one of these labels was **3.84:1 on the day flame** — the active filter chip, Submit, Save, and the check-in celebration button. Under AA for all of them (13px/700 and smaller; none qualify as large text). |
| `#trackChip`, `.vd-tonight`, `.vd-btn-primary` | `color: #131019` | `var(--on-flame)` | Same value, three separate spellings. These three were the only ones that were *right* — the bug was that the other five disagreed with them and nothing named the shared value. |
| `.status-pill.soon` / `.closed` | `#FF7A5C` / `#D8D2E0` | `var(--pill-soon)` / `var(--pill-closed)` | Values unchanged, and still deliberately not in the light block (the existing comment explains why they don't follow the theme). They just have names now. |
| `.status-pill` label | `color: #131019` | `var(--on-flame)` | same value, now the same source as the rest of the family |
| `renderMarkers()` — the No.1 pin | `pinSVG('#FF5A3C' …)` | `var(--flame)` | Every other pin colour goes through `COLORS` → `var(--pin-*)` and flips with the theme. The "tonight" pin was pinned to the **night** flame, so on the day map it was a brighter red than the ordinary bar pins sitting next to it. |
| `renderMarkers()` — fallback | `'#8A8494'` | `var(--mute)` | night `--mute`, hardcoded |
| `renderMarkers()` — "tonight" sub-label | `style="color:#FF5A3C"` | `var(--flame)` | same |

**Not changed, reported instead:**

- `drawRouteLayers()` — `'line-color': '#FF5A3C'` on `route-line`. MapLibre
  paint properties can't take `var()`, and the casing directly above it
  *does* branch on theme (`routeCasingColor()`), so the two halves of the
  route disagree: the casing changes with the theme and the line does not.
  It may be deliberate (the casing's job is to make one line colour read on
  both tile sets) — but if it is, nothing says so, and `#FF5A3C` will drift
  if `--flame` ever moves. **Your call.** `venueTileUri()` shows the pattern
  for reading a token from a place MapLibre can't: it reads the computed
  custom property with a hex fallback.
- `routeCasingColor()` returns `'#0B0910'` on night, which is not a token
  and not in the palette at all (it is darker than `--ink`).
- `AVATARS` and the `ITEM_LAYERS` / `avatarSVG()` drawings use literal hex
  that duplicates `--ink2`, `--violet`, `--teal`, `--flame`, `--gold`. Left
  alone: an avatar should look the same in both themes, so these *should*
  not be tokens. Worth a comment saying so, which they don't have.
- `BADGES[].icon` in `js/app.js` carries emoji (`'🔥'`, `'🧭'`…) that
  nothing reads — `BADGE_ICONS` overrides them by design (there's a good
  comment on it). The dead `icon:` property is a trap for the next person.

### A2 — contrast, both themes

Method: a script walking every rendered element, compositing the real
background up the ancestor chain **including gradient colour stops** (so a
card is measured against `--card-fill`'s top and bottom, not just its
background-color), applying accumulated `opacity`, and applying WCAG's
large-text rule properly (≥24px, or ≥18.66px at 700+ — note **14px bold is
not large text**, which matters for `.t-hours`). Run over Home, the venue
sheet, You, the map, the submit form, the edit form and the admin queue, in
both themes, at 320 / 390 / 1280.

**Started at 25 distinct failing pairs on the browse screens alone.**

**Root cause 1 — `--dim` used as body text on night: 2.22–2.31:1.**
Below even the 3:1 non-text floor, on the default theme. `--secondary`
already existed *precisely* to solve this and the `:root` comment says so,
but only a subset of consumers had been moved to it. 18 rules were still
reading `--dim` directly: `.hint`, `.sec-note`, `.sec-empty`, `.vd-dim`,
`.vd-dot`, `.vd-title-sep`, `.vd-row-sub`, `.vd-vibe`, `.cel-capped`,
`.fl-item-req`, `.ed-charcount`, `.ed-hdash`, `.ed-photos-empty`,
`.travel-measuring`, `.photo-ph`, `.empty`, the map attribution link, plus
three inline `var(--dim)` spans in `app.js`. All moved to `--secondary`.
On day this is a no-op (`--secondary` *is* `--dim` there). `--dim` keeps its
non-text uses (hairline borders, the `.sec-h` dot, scrollbar hover).

**Root cause 2 — night `--mute` was 3.92:1 on the card gradient's top stop.**
4.84:1 on the ground, but only 4.45:1 on `--ink3` and 3.92:1 on `--ink4`,
and the top half of every card on Home sits on the light end of that
gradient. `--mute` `#8A8494 → #948F9D`: hue 262.5° and saturation .07 held
exactly, lightness .549 → .589. Now 5.56 / 5.11 / 4.51 on ground / ink3 /
ink4. Day's `--mute` is unrelated and untouched.

**Root cause 3 — flame as *text* on cream.** `--flame` `#E8462A` reads
3.84:1 on the day ground and **3.21:1** on the flame-tint wash behind
`.surprise-btn` and the rain weather bar — the worst number in either theme,
on the one line on Home that is meant to change someone's plan. It was also
the colour of every error line on the owner form. New `--flame-text`:
`var(--flame)` on night (5.65:1 already), `#C52F15` on day (hue 8.8° and
saturation .805 held, lightness .537 → .429). 4.50:1 on the wash, 5.38 on
the ground, 4.90 on the card's lower stop. Seventeen text rules moved to it;
borders, `accent-color`, outlines, the progress bar, the loading ring and the
map label keep `--flame`.

**Root cause 4 — `.nav-item.active`** was flame-on-cream at 3.84:1. Fixed by
root cause 3.

**Where it ended up:** the only AA failures left in either theme, at any of
the three widths, on any screen, are these, and none of them is a colour:

| what | night | day | note |
|---|---|---|---|
| `.t-sub` on a **closed** card | 5.06 ✓ | **4.09** ✗ | see §A3 |
| `.fl-item-req` / `.fl-item-name` on a **locked** avatar slot | 2.02 / 3.79 ✗ | 1.77 / 2.65 ✗ | `.fl-item.locked { opacity: .45 }`. The text at 1.77:1 is the line telling you *how to unlock it*, which is the one thing a locked slot has to be able to say. A deliberate dim, like the closed fade — same trade-off, and I did not change it either. |
| `.fl-item-req` "earned" | ✓ | 4.32 | day `--secondary` on the card's lower stop; the pre-existing limit the light block already documents |
| `#checkinLabel` when disabled | ✓ | 4.01 | `.vd-btn:disabled { opacity: .6 }` — WCAG 1.4.3 exempts disabled controls. Not a violation. |

Two more the tool flagged that are **not real** — I checked both by eye:

- `.fl-streak` "3" at **1.05:1 in day**. The tool composited it against the
  card; it is actually positioned over the flame illustration. Not a 1.05
  failure — but zoomed in, cream on the flame's pale yellow core with only
  `0 2px 8px rgba(0,0,0,.35)` behind it does read weakly in day theme. A
  tighter, stronger halo would fix it. Left alone: it's your illustration.
- `#pfpBtn` "😊" — emoji paint their own colours, `color` is irrelevant.

### A3 — `.card.closed { opacity: .82 }`

At `.82` the two most useful lines on a closed card — `.t-sub` (the address)
and `.t-hours` — measured **3.90:1 night / 3.38:1 day**. Those are exactly
what someone reads to decide whether to bother going.

Raised to `.92`, which is the highest-signal value that clears AA on night
(5.06:1). **It does not fix day** (4.09:1), and cannot: day's `--secondary`
is 4.32:1 on `--card-fill`'s lower stop *before any fade*, so no opacity
reaches 4.5 there. The three ways out, with numbers, are written into the
comment on the rule. In short:

- **(a)** drop the fade — the status pill already says "Closed" explicitly,
  and that rule's own comment calls the fade "only a secondary hint". Zero
  contrast cost.
- **(b)** darken day's `--dim` to `#6A6254` — clears 4.51 faded everywhere,
  but lands within a hair of day's `--mute` (`#6B6151`), so day stops having
  three distinguishable levels of text.
- **(c)** accept 4.09:1 on the sub-line of a closed card.

I set **(c)**, because (a) and (b) are both visible design decisions. At
`.92` the fade is close to invisible, so honestly (a) is probably right and
you should just delete the rule. What is *not* an option is going back to
`.82`.

### A4 — dead code

Removed from `css/style.css` (nothing in `js/*` or `index.html` ever applies
them — checked by extracting every class token from `class="…"`,
`className =`, `classList.*()`, `querySelector*`, `closest`, `matches`, and
soft-matching runtime-built names like `'marker type-' + v.type`):

- `.btn-checkin` + `.ready` + `:disabled` + its two light-theme overrides —
  superseded by the `.vd-btn-*` family. `updateCheckinButton()` still adds a
  `.ready` class and nothing has styled it since the move.
- `.stat-row`, `.stat`, `.stat b`, `.stat span`
- `.btn-fb`, `.btn-share`, `.btn-share:active`
- `.empty` (the live one is `.sec-empty`)
- `.photo-strip`, `.photo-ph` and their scrollbar rules

Three stale comment references to those selectors updated so the file
doesn't point at rules that no longer exist.

Removed from `js/app.js`:

- Two `console.log`s in `initMap()` dumping the Positron road-layer and
  symbol-layer arrays on **every light-theme style load**. Left over from
  tuning the day basemap; nothing reads them.

**Dead but deliberately left:**

- `startTracking()` / `updateTrack()` (~55 lines) are annotated *"kept for
  phase 2 check-in radius — no UI currently calls this"*, and that's true —
  nothing calls them. `stopTracking()` is called from five live places but
  only ever cleans up state that `startTracking()` sets, and `#trackChip`
  (which `initMap`'s CSS still styles) exists in no markup anywhere. So the
  whole tracking block plus `#trackChip`'s CSS is inert. Annotated intent, so
  I left it — but it is dead, not dormant.
- `js/app.js:24` logs `?debug=1 seen at script start` on **every page load
  for every visitor**, and `js/app.js:170` is a block literally headed
  *"TEMP diagnostic — remove once the retry flow is confirmed working."* Both
  are argued for in their comments and I can't confirm the retry flow, so
  both stayed. Flagging that the TEMP one has outlived its note.

### A5 — pairs of values that must agree but are written separately

This is the pattern that has caused five bugs here, so I went looking for all
of it rather than only the instances that were currently broken.

**Actually broken, fixed:**

1. `color: var(--ink)` vs `color: #131019` on a flame fill — five rules said
   one thing, three said the other, and only the three were right. → `--on-flame`. (§A1)
2. `showCelebration()` labelled **two different numbers "Your flame"** —
   `phai_stage` (lifetime rank) and `heat_level` (current heat). When heat
   had changed the card read *"Your flame · Flicker"* then *"Your flame ·
   warm"*, back to back. `functions/api/_heat.js` is explicit that these are
   different things ("heat is a mood, not a rank"). The heat row now says
   **"Burning"**. It also printed the raw lowercase token while the row above
   it capitalised via `stageLabels` — `cap()` was a local inside
   `statusPillHtml()`, so I lifted it to the shared helpers and both use it.
   *The word "Burning" is mine — it's your voice, change it.*
3. `[data-theme="light"]` pushable-shadow overrides listed `.chip.on`,
   `.btn-checkin.ready` and `.cel-done` but **not** `.fl-invite-btn`, which
   therefore kept a night-flame-derived `#C6432A` edge on the day theme.
   Added (and the dead `.btn-checkin` entry dropped).
4. `#staleWarningClose` was never in `#mapWarningClose`'s selector, despite
   being the identical control in identical markup — so the stale-data
   warning's dismiss button rendered as a raw UA `<button>`, grey bevel and
   system font, next to a styled circle. They share the rule now. Nobody
   caught it because the two warnings almost never show together.
5. `.card.closed .card-body { opacity: .82 }` and
   `.card.closed.card-big .card-body > * { opacity: .82 }` are two literals
   that must match. Both moved to `.92` together; noted in the comment that
   they're hand-synced.

**Verified in sync, left alone (all now have or already had a note):**

- `RIVERSIDE` (`js/app.js`) vs `RIVERSIDE_VENUES` (`functions/api/checkin.js`)
  — identical, 8 ids. Already carries a "must stay in sync" comment.
- Badge thresholds: client `BADGES` progress hints (10 / 5 / 3 / 1) vs the
  server's checks in `checkin.js` vs the seeded rule text in
  `migrations/003_badges.sql` — all three agree.
- `RAIN_LIKELY_PCT` (`js/app.js`) vs `RAIN_LIKELY` (`functions/api/weather.js`)
  — already documented as a must-match pair.
- `'marker type-' + v.type` (JS) vs `.marker.type-bar` (CSS) — a class name
  built by concatenation. Works, but invisible to any search for `.type-bar`.
- Splash CSS in `index.html` duplicating `.lring`/`.lring-arc` from
  `style.css` — deliberate and well commented.
- `night-owl` is the one loose end: the server awards it at
  `vientianeHour < 5`, the migration's rule text says "after midnight", and
  the client's progress hint hardcodes `have: 0` so its bar never moves even
  once earned. Harmless (the server owns earned-ness) but the three
  descriptions of one rule don't quite match.

---

## B. Accessibility

### B1 — keyboard focus: there was none

**Nothing in `css/style.css` styled `:focus` or `:focus-visible` anywhere**,
except `.ed-input:focus`, which *removes* the outline. Measured across Home,
the venue sheet, You and the map: no visible ring on any button, chip, pill,
nav item or link. WCAG 2.4.7, failing app-wide — the app was not usable by
keyboard in any followable way.

Added one ring at the end of the file:

```css
:root { --focus: var(--bone); }
button:focus-visible, a[href]:focus-visible, … { outline: 3px solid var(--focus); outline-offset: 2px; }
```

`--focus` is `--bone` deliberately rather than a new colour: `--bone` is the
primary text colour, so it is already light on night and dark on day and is
high-contrast against every surface in its own theme with no second token to
keep in sync. `outline-offset` puts the ring on the surface *behind* the
control, so it never has to read against a flame or teal fill.
`:focus-visible`, not `:focus`, so a tap doesn't leave a ring behind.

The block is **last in the file on purpose** and says so: `.ed-input:focus`
is `(0,1,1)`, the same specificity as `input:focus-visible`, so only source
order makes the ring win. Moving that block earlier silently disables it.

### B2 — 44×44 touch targets

Measured every interactive element at 390 and 320 in both themes across
Home, venue, You, map, the submit form, the edit form and the admin queue.
**28 controls were under 44px.** All fixed; the method was chosen per control
from the measured clearance to its nearest interactive neighbour, never
blanket:

- **Invisible `::after` hit-slop**, where the drawn size is load-bearing and
  there is room: `.pill` (36px tall, and `#themeBtn` only 35 wide — the pills
  sit 16px apart even at 320px, so −5px a side leaves 6px clear), `.chip`,
  `.vd-round`, `.vd-btn-icon`, `.vd-more`, `.vd-phone`, `.sheet-x`,
  `.ed-fb-warn-move`, both warning-dismiss buttons.
- **Real height**, where slop would have caused mis-taps:
  - `.vd-links a` — two links 19px tall stacked **4px apart**. The slop
    needed (≈12px a side) would have put each link's box over the other, so
    the wrong destination would open. Gap → 0, each link → its own 44px row.
  - `.fl-avatar-link` / `.fl-signout` on You — 26px and 19px tall, stacked
    14px apart. Same trap. `min-height: 44px`.
  - The owner forms: `.ed-input` (41.3px — 2.7px short, on every text field),
    `.ed-hfrom`/`.ed-hto`, `.seg-btn` (the Bar/Café toggle, 31.3px), and
    `.ed-hrow-toggle` (the label that ticks a day open was **16px tall**,
    with only 8px between rows).

One thing still reports small and is **not** a failure: `input.ed-hopen`, the
16×16 day checkbox. Its `<label>` is now 44px and is the activatable region —
the whole "Mon" row toggles the day — which is what WCAG counts. My tool
measures the input box, not the label.

### B3 — icon-only buttons

Audited every `button` / `a[href]` / `input` / `[role=button]` for an
accessible name across all screens, plus a static scan of every `<button>`
in `js/*` and `index.html` whose literal text is ≤2 characters.

**One unlabelled element in the whole app:** `.av-opt`, the six avatar
choices. Their entire content is an `<svg>`, so a screen reader announced six
identical "button"s with no way to tell which was selected. Now
`aria-label="Avatar N of 6"` plus `aria-current` on the selected one.

Everything else was already labelled — the lightbox controls, the photo
reorder/remove buttons, the nav, the warnings. `lightboxRender()` already
sets a real `alt` on the lightbox image; the `alt=""` in the template is just
its initial state (added a note so the next reader doesn't "fix" it).

### B4 — `prefers-reduced-motion`

Wrote a checker that parses the stylesheet, pairs every `animation` /
`transition` declaration with the reduce-block rules that claim to neutralise
it, and flags (i) motion with no override, (ii) overrides that lose on
specificity, (iii) overrides whose selector matches nothing.

**The override that had silently lost the cascade — `.marker.pin-event svg`
at line 314.** It is `(0,2,1)`. The two rules it has to beat are
`.marker.pin-event:not(.zoom-dot) svg` `(0,3,1)` and
`.marker.pin-event.zoom-dot.selected svg` `(0,4,1)`. It never applied, so the
event pin kept bobbing under reduced motion. Now lists both selectors
exactly. This is the *same failure* the `[data-vibe-tag]` block further down
already documents having been caught by testing — that note was right and was
just never applied here.

**Second instance, same shape:** the reduce block for the mood-card
entrances lists every `[data-vibe-tag=…]` and `[data-mood-type=…]` selector
but not the two `[data-list-key=…]` ones, which were added later — so Newly
opened's glow and Our picks' bottle still animated. Added.

Also gated, all previously ungated:

- `.fl-flame` — its own `transition: transform .6s, filter .6s` fires on
  every heat change; only `.intro-flame` had been covered.
- `#topbar` and `#sheetToggle` — the desktop collapse slides them 400px in
  450ms. `#sheet`'s own transition was already inside the `no-preference`
  block; these two were written separately from it and missed.
- `.ed-photo-highlight` — a 1.6s flash. Not killed outright (that removes the
  "look here" affordance): the ring is held static instead, and
  `wireVenueEditor()` removes the class after 1600ms either way.
- **Four `scrollIntoView({behavior:'smooth'})` calls in JS.** These take their
  own behaviour argument and ignore the media query entirely, so the chip
  centring and the editor's scroll-to-photos still animated. New
  `scrollBehavior()` helper; `showMoodIntro()` was already doing this by hand
  with its own flag, so this is the same decision in one place.

Re-ran the checker afterwards: no ungated motion, no losing overrides, no
stale selectors.

**Deliberately not changed:** `.cel-done:active` and `.fl-invite-btn:active`
are pushable buttons whose press is `transform: translateY(3px)` *plus* a
`box-shadow` collapse. Killing only the transform leaves the shadow saying
"pressed" while the button hasn't moved, which looks broken. `.vd-btn:active`
gets away with it because its pressed shadow is an `inset`. Fixing these
properly means designing a reduced-motion pressed state — your call, not a
find/replace.

---

## C. Performance

### C1 — splitting `js/app.js`

`index.html` already fetches `data/venues.json` and the stylesheets in the
head before `app.js` has finished downloading, so on a phone the critical
path really was this one file's download + parse + compile.

Moved out, as **on-demand classic scripts**:

- `js/owner.js` — the submit form, the edit form, the admin pending queue,
  the venue photo uploader, and their shared `ed*` helpers.
- `js/avatar.js` — the avatar picker and the profile-photo upload.

```
                 raw                      gzip
app.js   322,307 → 270,210  (−16.2%)   101,470 → 89,566  (−11.7%)
```

with 62,203 raw / 16,505 gzip now in `owner.js` and 7,299 / 2,998 in
`avatar.js`, neither of which is on the boot path.

**Why classic scripts and not modules.** Classic scripts share one global
lexical scope, so the moved code still resolves `esc()`, `setSheet()`,
`state`, `cloudinaryUrl()`, `openFlameSheet()` and everything else out of
`app.js` **by name, unchanged**. It was a cut and paste — not one line of the
1,315 moved lines was edited. A module would have needed an export/import
list threaded through all of it, which is exactly the full-block rewrite
CLAUDE.md warns hides silent edits. The two rules that follow from this
(nothing may touch a chunk's symbols before its promise resolves; a chunk
must never execute twice or its top-level `const`s throw) are written into
the `loadChunk()` comment, and the cache is only cleared on `onerror`, which
fires when the script never ran.

`loadGoogleSignIn()` was already doing this for the Google script — this is
the same pattern applied to our own code, and the loading is timed the same
way: `openFlameSheet()` starts `avatar.js` at the same moment it starts the
`/api/me` round trip the screen is rendered from, so it is normally resolved
before it is needed. `owner.js` is **not** fetched just because You rendered
— most people who open You are not owners. It is fetched on the tap, and
prefetched only for someone who actually has a Manage or Pending button.

Verified in the browser: boot loads `js/app.js` only; opening You adds
`avatar.js` (and `owner.js` for an owner/admin); the submit form, the edit
form, the admin queue and the avatar picker all render and wire correctly
with **zero console errors**; the cold path (`withChunk` with nothing
prefetched) works; and a failed chunk load rejects with a message and leaves
the cache clean so a retry is possible.

### C2 — what else was blocking first render

Two **render-blocking stylesheets on third-party origins** in the head:
`fonts.googleapis.com` and `unpkg.com`. Nothing on the page could paint —
not even the splash, which is otherwise entirely self-contained inline CSS —
until both had been resolved, connected to and read. Two round trips to
someone else's server in front of the first pixel.

Both are now `rel="preload" as="style"` promoting themselves on arrival, with
`<noscript>` fallbacks. The font swap this can cause **is not new behaviour**:
the Google Fonts URL already carries `display=swap`, so a first frame in the
fallback stack followed by a swap was already the designed behaviour on a
slow connection. This only makes that frame paint sooner. maplibre-gl.css
styles the map's own controls and nothing else, and maplibre-gl.js is already
`async`, so those controls don't exist until well after it lands either way.
**If it reads badly on a real phone, reverting is those two lines.**

`css/style.css` is 66KB gzipped and render-blocking. Splitting it into
critical + deferred needs a build step, which is a deliberate non-goal here,
so I left it. It's the next-biggest item on the critical path.

### C3 — what I could NOT measure, and why

**I cannot give you a before/after wall-clock "time to first venue visible",
and I don't want to imply otherwise.** Two independent reasons:

1. Every tab driven through the browser tooling on this machine reports
   `document.hidden === true`. Chrome suspends `requestAnimationFrame` in a
   hidden page, and `mark()` fires inside a `rAF` — so `muan:venues-rendered`
   and `muan:splash-lifting` **never fire at all** in this setup. The
   instrumentation that would answer this question is exactly the part that
   can't run.
2. The measurement was against a local static server. `app.js` arrived in
   13ms. There is no network, so there is nothing for the split to improve
   and any number would be meaningless.

What I can state is the part that is real and load-bearing on a phone:
**54,229 fewer bytes (11,904 fewer gzipped) to download, parse and compile
before the first venue can render**, and two third-party round trips removed
from in front of the first paint. The wall-clock figure needs a real device
or a throttled DevTools trace — worth doing before you trust the size numbers
to mean what they should.

---

## D. Known outstanding work

### D1 — Lao labels and worked examples on the owner forms

Lao *labels* already existed from an earlier pass. What was missing is what
actually failed: Sunin submitted with `short` and `description` null, `"."`
typed into parking, and her Facebook link pasted into Website, and said she
didn't know what "short name" or "tagline" meant. **A label tells you what a
field is called; an example tells you what to type.**

Added:

- An `eg` / `eg_lo` pair on 14 of the 15 fields (the `type` select is its own
  explanation), rendered by `edLabelHtml()` in a quiet tinted well *inside*
  the `<label>` — so tapping the example focuses the field it describes.
- `edBlankHintHtml()`, one line at the top of **both** forms (shared, so they
  can't drift): *"Not sure about something? Leave it blank. We would rather
  have an empty field than a guess, and you can add it later."* That is this
  project's actual data rule, stated to the person it applies to. Parking was
  already marked optional and she still typed `"."` — a per-field marker
  reads as paperwork; a sentence before any field reads as permission.

**None of the examples name a venue or quote venue data.** They describe the
*shape* of a good answer ("the part people actually say out loud", "the
neighbourhood you would give a tuk-tuk driver"), never a specimen answer, so
nothing in them can be mistaken for a record or drift out of date with one.

> **⚠ TODO(lao) — the thing in this diff most likely to do real harm.**
> Every `lo` and `eg_lo` string is **my own unchecked translation**. The
> fourteen `eg_lo` lines are new and are *prose*, not labels — several
> sentences each — and longer prose is exactly where a machine translation
> goes wrong in a way a non-speaker cannot see. This is the one screen where
> a wrong word makes a real owner type something wrong into the database.
> The block comment on `OWNER_FIELD_LABELS` says this too, and says the right
> fallback: **if any line is doubtful, delete the `eg_lo` and keep the
> English. An example in one language beats a wrong example in two.**

### D2 — open-air on the venue detail sheet

The card note (`outdoorNoteHtml()`) only speaks when rain is actually a
factor, which is right for a scan surface. The sheet is where someone commits,
and "this place has no roof" is worth knowing before you set off whether or
not it happens to be raining as you read it.

New row in the factual group, between hours and links, with the sky icon:
**"Open-air · ກາງແຈ້ງ"** and a sub-line that changes with `rainState()` —
*"raining now — it may be shut"* / *"rain likely tonight — it may shut"* /
*"no cover if the weather turns"*.

Strictly `v.outdoor === true`, never truthiness. `outdoor` is a three-state
field and **absent means nobody has audited the venue**, which must not
render as "indoors". `outdoor: false` renders nothing here either — that's a
real audited fact, but "this place is indoors" is new editorial surface and
adding it is your call, not a side effect of adding the row that was asked
for. Verified all three states in the browser against a patched local fixture.

**All 30 venues currently have `outdoor` absent**, so both the card note and
this row are inert today. The column, the API, the export and the UI are all
plumbed end to end — it's waiting on you auditing venues, which is exactly
where migration 016 left it. (`ກາງແຈ້ງ` is also unchecked — TODO(lao).)

### D3 — do past events still render?

**No. The date filter works.** `boot()` does
`state.events = eData.events.filter(ev => !isPast(ev.date))`, so past events
never enter `state` at all. Of the 7 events in `data/events.json`, 6 are in
the past as of today and only `2026-09-27 Mekong Half Marathon` survives.

But there is a real hole next to it, and I fixed it: **that filter runs once,
at load, against `todayISO()` as it was at load.** A tab left open across
midnight — a phone in a pocket from 11pm to 1am, which is this app's whole
situation — still has yesterday's event sitting in `state.events`. Home
re-derives its own `today` on every render so it drops out of Tonight and
Upcoming on its own, but `venueEvents()` read the list raw, so **the venue
sheet would have gone on showing a finished event labelled TONIGHT until
someone reloaded.** `venueEvents()` now re-tests the date.

---

## E. Other things found

- `.sec-h .dot` (the section-header dot that replaced the flame in
  d516a19) is `--dim`, which on night is **2.42:1** against the ground — very
  nearly invisible. It's decorative so it's not a WCAG failure, but if it's
  meant to be seen it isn't. Deliberately not touched: it's a design decision
  from three commits ago.
- `initMap()` has two consecutive `if (state.theme === 'light')` blocks that
  could be one. Cosmetic, left alone.
- `data/candidates.json` — venue research, see below.

---

## Venue research → `data/candidates.json`

**28 candidates, cafés and bars in Vientiane. Nothing touched `venues.json`,
D1, or the export script, and nothing in the repo references the file** —
verified by grep (the only `candidates` hits in `js/` are an unrelated local
variable in `quickSurpriseMe()`).

Cross-checked against all 30 existing ids; Common Grounds, Tipsy Elephant,
Wind West and Corebeer excluded as duplicates. Sinouk Coffee Pavilion (KM9
Thadeua Rd) is included and flagged as a *different branch* from the existing
`sinouk-khemkhong` (Quai Fa Ngum), not a duplicate — with a note that it
needs its own id, coordinates and hours rather than a copy.

Split by source quality, as the brief asked: **25 have a primary source** (the
venue's own Facebook page — one of them only a post on a hotel's page, marked
as weaker), **3 are lead-only** and say so.

**Every single `hours` is `null`, and that is a finding rather than a gap.**
Facebook renders page content behind a login/JS wall: I fetched
`facebook.com/damdamcoffee` directly and got the name and the city and
nothing else — no address, no hours, no phone, no closed marker. Google Maps
listings aren't fetchable either. Aggregators *do* print hours, but an
aggregator is a lead, and copying hours out of one is precisely what
CLAUDE.md forbids. Where I saw an hours claim I recorded it in a separate
`hours_lead` field with its provenance and a "do not copy this into a venue
record" note, so the claim isn't lost but can't be mistaken for data.

Also recorded per the brief: **I found no footfall or popularity data for
Laos and used none to order anything.** Google's popular-times is in no API
and is only reachable by scraping the Maps page. There is no Lao equivalent
of Yelp. The Tripadvisor/Wanderlog review counts for Vientiane venues are in
the low tens and are dominated by visitors, so they measure tourist traffic,
not whether a place is busy on a Tuesday. If something turns up claiming to
be Lao footfall data, treat it as a lead and write down where it came from
before anything in the app is ordered by it.

No candidate showed a positive closure signal — which is **not** the same as
"all of these are open", since the only signals available (a Facebook page
marked closed, a Maps listing marked permanently closed) are exactly the ones
I couldn't read. Trading status is unknown for all 28. The file says so.

Several entries carry a warning worth more than the entry: a few names read
equally as a venue or as a roaster/importer/brand page (`Lao Specialty
Coffee`, `Vientiane Craft Beer`), and this app pins places you can *go*.
Establish that before researching further. Naked Espresso has multiple
Vientiane branches, so any record must name the branch and must never borrow
another branch's hours or coordinates.

---

## What I could not verify

- **Any wall-clock timing.** rAF is suspended in the driven tab, so the
  `mark()` instrumentation never fires, and the local server has no network
  latency to improve on. §C3. The byte counts are real; the timings need a
  device.
- **The focus ring rendered on screen.** I confirmed both rules parse, that
  `:focus-visible` matching works in this browser (observed it match on a
  real Tab), and that the declarations resolve and paint (`solid 3px`,
  `--bone`, `offset 2px`) by mirroring them onto `:focus`. But keyboard focus
  does not reliably enter a backgrounded tab here, so **I never saw the ring
  itself.** Please tab through Home and the venue sheet in both themes once.
- **WebKit.** Everything was measured in Chromium. This codebase has shipped
  sticky bugs that only existed in Safari; the sticky chip bar and
  `#sheetTopCover` were not re-tested and nothing I changed touches them, but
  `.vd-links a { display: inline-flex; min-height }` and the `::after`
  hit-slop are both worth a glance on a real iPhone.
- **Real touch.** Hit-slop was verified by measuring boxes and clearances, not
  by thumbs. The `.vd-links` and `.fl-avatar-link` cases are the ones where I
  chose real height *because* slop would have overlapped — if any control now
  feels like it steals a neighbour's tap, those are where to look.
- **The Lao.** All of it. §D1.
- **Anything about the 28 candidates beyond "a page with this name exists and
  is indexed as Vientiane".** No address, no hours, no phone, no trading
  status, and for several of them not even whether it is a venue.

---

# Autonomous run — 2026-09-14

Kar: second unattended session. **Nothing is committed and nothing is pushed.**
No migration was run against `--remote` — none was written into `migrations/`
either, and §B3 says why that was the right call rather than an omission. No
venue data was added, edited or invented; `data/venues.json`, `data/picks.json`
and `migrations/` are untouched. Research went to `data/candidates.json` only,
which nothing in the repo loads (re-verified by grep).

```
 M css/style.css        (contrast, one new token, one new rule)
 M js/app.js            (repeat events, boot resilience, 9 swallowed failures)
 M js/avatar.js         (one aria bug)
 M data/events.json     (repeat field on the two weekly fixtures — no new events)
 M data/candidates.json (+23 restaurants, staging only)
 M PHASE2.md            (§6 and §7 — the header was already correct, see B4)
?? design/events-repeat.sql   (NOT a migration. Read its header.)
```

**Read these four first — they are where I made a call you might reverse.**

1. **`.card.closed`'s fade is deleted, not softened.** You asked me to make the
   call. I also found the previous run's numbers were wrong: it fails on
   **night** too, at every width. §A2.
2. **`--wash-flame` is a new token and its alpha dropped .16 → .12.** The rain
   bar and Surprise me were still failing AA — the previous run believed they
   were fixed. The wash is now 25% weaker. §A3.
3. **`repeat` on events is a change to `data/events.json`'s shape, not to D1.**
   I deliberately did *not* put a migration in `migrations/`. §B3.
4. **The restaurant research cannot be used yet.** `restaurant` is not a venue
   type this app has, in six files. §D.

---

## A. The four remaining contrast failures

Method as before: a walker compositing the real background up the ancestor
chain including gradient stops and the `#sheet` texture, applying accumulated
opacity, applying WCAG's large-text rule properly. Run over Home (All / Bars /
Cafes / Events), the venue sheet, You and the submit form, in both themes, at
320 / 390 / 1280.

**All four are fixed. Two of them were worse than reported, and I found two
more the last audit had marked solved.** Final state: at 320, 390 and 1280, in
both themes, on Home, the venue sheet, You and the owner form, the walker
reports **zero** failing text pairs other than the four known non-failures at
the bottom of this section.

### A1 — the locked avatar slot (`.fl-item-req` 1.77:1, `.fl-item-name` 2.65:1)

Fixable without touching a token: it was never a colour. `.fl-item.locked` put
`opacity:.45; filter:grayscale(1)` on the whole tile, which is right for the
artwork and wrong for the text sitting under it. `.fl-item-req` at 1.77:1 is
the line that tells you *how to unlock the slot*, which is the only thing a
locked slot exists to say — and a locked chip is not a disabled control, so
WCAG 1.4.3's exemption does not apply.

Both declarations moved to `.fl-item.locked .fl-item-ico`. The affordance
survives intact — the picture is grey and faint, and "visit 3 cafés" vs
"earned" already states the state in words. I looked at it in both themes
before and after; it reads *better*, because the tile no longer fades its own
card surface into the sheet.

| | before | after |
|---|---|---|
| `.fl-item-name` | 3.79 night / 2.65 day | 12.58 / 13.67 |
| `.fl-item-req` | 2.02 night / 1.77 day | 4.51 / 5.40 |

### A2 — `.t-sub` on a closed card, and the fade itself

**You asked me to make the call. The fade is gone.** Three reasons, in order
of weight:

1. **The previous report's night number was wrong, and that changes the
   decision.** It recorded night 5.06 ✓ / day 4.09 ✗ and framed the choice as
   "accept one failing theme". Measured against the surface the text actually
   sits on — on a phone `.card` resolves to a **flat** `--ink4` / `#FFFDF8`,
   not the desktop gradient — it is **4.05 night / 4.09 day**. Both themes,
   every width. The trade "day only" never existed.
2. Unfaded it passes in both: **4.51 night / 4.73 day**. Deleting the rule is
   the whole fix, with nothing else to move.
3. Nothing is lost. The pill on the photo says **"Closed"** in words, is
   exempt from any fade by design, and that rule's own comment already called
   the fade "only a secondary hint". At `.92` it was very nearly invisible —
   it was costing the address and the hours 0.45 of contrast to deliver a
   signal nobody could see.

`.card.closed` / `.hcard.closed` / `.collage-card.closed` are still applied by
the three card renderers and kept as a state hook with **no visual treatment of
its own**. The three measured rows are written into the comment so nobody dims
it back without re-reading them, along with the one real constraint: if a
closed card ever needs a stronger at-a-glance mark, it has to come from
something that is not opacity on the text. I also corrected the `.status-pill`
comment, which pointed at the fade as a co-signal — that pill is now the only
thing that says a venue is shut.

### A3 — `.fl-item-req` "earned" at 4.32 day, and two the last audit thought it had fixed

The 4.32 is the documented day limit: `--secondary` resolves to `--dim`
(`#7A7060`), which is 4.32:1 over `--card-fill`'s lower stop `#F7F1E4` — and
this 9.5px line sits at the bottom of the chip, i.e. exactly on that stop. The
previous run listed two ways out and rejected both. There is a third that
needs no token to move: this is the **one consumer** that lands there, so it
reads `--mute` instead. Day's `--mute` (`#6B6151`) is 5.40:1; on night
`--secondary` *is* `--mute`, so night is byte-identical at 4.51. `--dim` and
`--secondary` are untouched for the other 17 rules.

**Then the two that were reported as fixed and were not.** `--flame-text`'s own
note claimed 4.50:1 on the flame wash, computed as `rgba(255,90,60,.16)` over
cream. The wash does not composite onto cream: it sits inside `#sheet`, over
that element's repeating-gradient texture, and the honest number is the
darkest stripe of it.

| | night | day |
|---|---|---|
| `.weather-rain-text` (the rain line on Home) at .16 | 4.37 ✗ | 4.35 ✗ |
| `.surprise-label` (Surprise me) at .16 | 4.37 ✗ | 4.35 ✗ |
| both, at .12 | **4.64 ✓** | **4.55 ✓** |

Night cannot be fixed from the text side — `--flame-text` *is* `--flame` there,
and the only lift available is a brighter coral sitting next to the real one on
the same screen. So it is fixed at the surface: **the wash alpha is .12.** The
cost is a 25% weaker tint, which I judged worth it — the bar's salience comes
from 13.5px/700 coral and the icon, not from 16%-vs-12% of ground. I looked at
it in both themes; it still reads as a coral bar.

While fixing it I found the actual structural fault. `rgba(255,90,60,.16)` was
written **three times in three rules** — the rain bar, `.surprise-btn`, and the
owner form's permission slip — and two of them put `--flame-text` on top of it.
The owner form's copy had *already* been re-measured at 4.37/4.35 and had its
flame text removed; nobody went back to the other two. That is this file's
signature bug. It is now one token, **`--wash-flame`**, whose comment carries
the numbers and the rule that any text on it must be measured against the
darkest point of its surface. The two comments that carried the wrong figure
(the `--flame-text` light-block note and `.ed-blank-hint`'s) now carry an
explicit correction rather than a quiet edit.

### A4 — `#checkinLabel` when disabled, 4.01 day

**Not fixed, and not a failure.** `.vd-btn:disabled { opacity: .6 }`, and WCAG
1.4.3 exempts disabled controls. I left it. Flagging one thing though: the text
in that disabled button is a *state message* ("Location blocked", "Too far to
check in"), not a label, so it is doing work the exemption does not really
contemplate. If you ever want it above 4.5, the fix is to move the message out
of the button rather than to raise the disabled opacity.

### Bonus: the selected map pin's label

`.marker.selected .m-label` was `--flame`, which the previous run deliberately
excluded from the `--flame-text` move on the grounds that a map label sits on
tiles and is unmeasurable. That argument does not hold for *this* one: the day
rule above it gives every label a 1px `#FFFCF5` outline on all four sides, so
the surface the glyph edges read against is cream, not the tile. Day's
`--flame` is 3.84:1 on cream; `--flame-text` is 5.38:1. Switched. Night is
byte-identical. The comment ties the two rules together — remove the outline
and it goes back to being genuinely unmeasurable.

### Still reported, still not failures

- **`.m-label` at op .38** (2.26 day / 3.3 night) — `.map-has-selection .marker`
  dims every unselected pin. Has a halo, sits on unknown raster tiles.
- **`#pfpBtn` "😊" at 1.31** — emoji paint their own colours.
- **`.fl-streak` "3" at 1.05 day** — the tool composites it against the card;
  it is over the flame illustration. **I did look at it this time**: cream on
  the flame's pale yellow core with `0 2px 8px rgba(0,0,0,.35)` behind it does
  read weakly in day theme. Still your illustration, still not touched.

### A5 — the split scripts still work

Verified after every change in this run. Boot loads `js/app.js` only; opening
You adds `avatar.js`, and `owner.js` too for an owner. The submit form (22
fields, 13 worked examples, the permission slip), the venue editor (19 fields),
the admin queue path and the avatar picker all render and wire with **zero
console errors**. All three files also pass a real ESM parse (dynamic `import()`
over `file://`, as CLAUDE.md requires — `app.js` reaches a runtime
`location is not defined`, which means it parsed).

---

## B. The work specced across sessions

### B1 — open-air on the venue detail sheet: already built, now verified

This shipped in e66c9ff (the previous run's §D2), so the task list predates it.
I verified it properly rather than taking the report's word: all three `outdoor`
states against all three `rainState()` branches, on a patched local fixture.

| `outdoor` | raining now | rain likely | dry |
|---|---|---|---|
| `true` | "Open-air · ກາງແຈ້ງ / raining now — it may be shut" | "…rain likely tonight — it may shut" | "…no cover if the weather turns" |
| `false` | no row | no row | no row |
| absent | no row | no row | no row |

The tri-state is honoured strictly. All 30 venues still have `outdoor` absent,
so it is inert in production until you audit venues.

### B2 — past events in Coming up

**They do not render, and they cannot.** `upcoming` is
`state.events.filter(ev => eventDate(ev) > today)` with `today` re-derived on
every render, so a tab held open across midnight re-sorts itself. Confirmed on
screen: today is Monday 14 Sept and Coming up shows THU 17 / FRI 18 / SUN 27,
with the four genuinely past one-offs gone.

**One real gap I did not fix, because fixing it means inventing data.** An event
whose `date` is today but whose `start_time` has already passed still shows as
**TONIGHT** all evening — the Mekong Half Marathon starts at 05:00 and would
say TONIGHT at 9pm. There is no `end_time` in the event schema and guessing one
is exactly what CLAUDE.md forbids. If you want this, the honest fix is an
optional `end_time`, filled in only where a source states it, and left null
everywhere else. I did not add the field on spec with no data behind it.

### B3 — `repeat` on events

Make Friends and Felicia X were both in `data/events.json` already **saying in
their own `short` line** that they run weekly ("every Thursday", "plays Fri,
Sat & Sun every week"), and both had silently expired, because a single `date`
can only be true once. The recurrence now lives in a field the app reads:

```json
"repeat": { "weekly": ["fri", "sat", "sun"], "until": null }
```

- `date` **does not move**. It stays the occurrence `source_url` actually
  verified, so a fixture's provenance is still a real night somebody checked,
  and a repeat that has not started yet shows its true first date instead of
  jumping to this week.
- `eventDate(ev)` returns the date an event should be *shown* as: for a one-off
  that is `date`; for a repeat, the next matching weekday on or after today,
  never earlier than `date`, or `null` once `until` has gone by. Recomputed on
  every call, never cached on the record — same midnight reasoning as
  `venueEvents()`.
- `eventExpired(ev)` replaces `isPast(ev.date)` at the boot filter and in
  `venueEvents()`. **All nine reads of `ev.date` now go through `eventDate()`**
  — the boot filter, the marker's "event tonight" test, `isNo1()`, the sort
  comparator, the Tonight/Coming-up split and four display sites. Missing one
  would have shown a fixture under its 2026-07 date.
- `repeatDays()` reads the existing `DAYS` constant rather than keeping a
  private copy of the same seven codes.

Verified against 11 cases: one-off past/future, weekly falling on a later day,
weekly falling on **today** (lands in Tonight, and the venue sheet tags it
TONIGHT), `until` already passed (hidden), `until` later this week (shows the
last occurrence), a repeat whose `date` is still in the future (does not jump
back), and empty / malformed / non-object `repeat` (falls back to `date`).

> **The judgement in this that is yours, not mine.** `until: null` is a claim
> about the future and nothing in the file can keep it true. A weekly night
> that quietly stops will keep rendering until someone re-reads the source. I
> wrote that warning into `_repeat_notes` in `data/events.json` along with the
> instruction not to guess an `until` "to be safe" — a wrong `until` hides a
> night that is still running, which is worse. Repeating events need to join
> hours in the weekly curation pass.

**The schema change, and why it is not in `migrations/`.** Events are not in
D1 — `data/events.json` is their source of truth (CLAUDE.md, Architecture
notes) — so the shape change is to that file, and it is documented in its
`_repeat_notes`. I still wrote the DDL, in **`design/events-repeat.sql`**, with
a header saying it is not a migration. Putting it in `migrations/` as `017_`
would have been actively harmful: `scripts/check-schema.js` reads
`migrations/*.sql`, works out what production D1 should contain, and exits
non-zero if anything is missing. A migration for a table production does not
have would fail that check on **every future run** and block every deploy,
including CSS-only ones. That script exists because migrations 008 and 010
shipped ahead of being run; feeding it something that can never pass would
train whoever hits it to ignore it. I ran `node scripts/check-schema.js` after
writing the file — still `Schema OK`, unaffected. Nothing was run against
`--remote`; the only `--remote` call in this session is that script's own
read-only `PRAGMA` batch.

### B4 — PHASE2.md

**The status header was already correct** — you fixed it on 2026-08-05 and it
accurately lists what is live and what is still gated. I did not change it, and
I am saying so rather than quietly "correcting" something that was right.

What *is* stale is further down, and I fixed both:

- **§6 (build order)** read as a plan with a "do not start a slice until the
  previous one is deployed" rule, while B and half of C had shipped ahead of D
  and E. It is now labelled **history, not status**, points at the header as
  the only part of the file that tracks reality, and each slice carries what is
  actually true as of today.
- **§7 (out of scope for phase 2)** still listed **venue owner accounts** and
  **photo uploads**, both of which are built and live — `migrations/006_owners.sql`,
  `functions/api/my-venues.js`, `functions/api/pending.js`,
  `functions/api/venues/[id].js`, all of `js/owner.js`, and
  `functions/api/upload-signature.js`. Removed, with a dated note saying *why*
  they moved (owner-side tooling, not the social/usage features Gate 2 is
  about) rather than deleting the record. Paid promotions, the cosmetic shop,
  push notifications and native apps stay out — I checked; none of them exists.

---

## C. Robustness

Each failure injected in isolation against a local server, on a real load.

### What the user sees

| failure | before | after |
|---|---|---|
| `/api/venues` 500 | fine — falls back to the bundle | unchanged |
| `/api/venues` 500 **and** stale-flagged | stale banner | unchanged |
| **`data/venues.json` 500, live API healthy** | **blank screen: 0 cards, empty sheet, no message** | list renders off `/api/venues` |
| **both venue sources gone** | **blank screen** | "Couldn't load any venues" + **Try again** |
| **`data/events.json` 500** | **"Nothing verified yet — new list every Thursday"** | "Couldn't load what's on — check your connection and reload. The venues below still work." Venues unaffected. |
| `/api/weather` 500, or hangs forever | widget absent, Home fine | unchanged |
| `/api/me` 500 / dropped | "Could not load — try again." **with nothing to try it with** | same message + a **Try again** that re-enters You, verified to recover |
| `/api/my-venues` 500 | already three-state, shows a retry | unchanged |
| geolocation **denied** | fully usable | unchanged, plus honest copy (below) |
| **maplibre-gl.js 404** | list fine, but the **Map tab was a blank viewport** | "The map didn't load… tap Home", in `#map` |
| **any venue tap, map missing** | **`TypeError: Cannot read properties of null (reading 'flyTo')`** | no throw |

### C1 — the boot path was one `Promise.all` and any rejection blanked the app

`boot()`'s catch was `console.error` and nothing else, and the three first-paint
fetches were one `Promise.all`. So **any** of them failing produced the same
thing: the splash lifts on an app with no venues, no message and no retry,
whose only record is a console line nobody on a phone can read. Measured with
the live `/api/venues` perfectly healthy: a 500 on `data/venues.json` alone
rendered 0 cards and an empty sheet. CLAUDE.md records this exact outcome
happening in production twice.

They are settled separately now, because they do not fail the same way:

- **Venues are the content.** The bundle and `/api/venues` are two independent
  copies of the same list and boot needs either one, so a failed bundle falls
  through to the live promise **already in flight**. If both are gone,
  `showDataFailure()` replaces the list with a message and a Try again —
  deliberately placed *after* the theme, nav and header are wired, so the frame
  and the theme toggle still work and only the content is missing, which is the
  truth. No auto-retry: both sources have already failed once, a silent loop
  would hammer a Worker that is probably already unwell, and the honest control
  for "this may just be your connection" is a button someone chooses to press.
- **Events and picks are not content.** A failure there must not cost anyone
  the venue list — and must not read as "nothing on tonight" either, which is
  C2.

### C2 — the audit you asked for: catches that swallow an error into an indistinguishable empty

All 52 `catch` sites across `app.js`, `owner.js` and `avatar.js`. Nine were the
pattern. `owner.js` was clean — every catch there surfaces a message — and so
were `fetchMyVenues()` / `fetchPendingVenues()`, which already carry the
three-state shape and the comment explaining why.

1. **`state.events = []` on a failed `events.json`** would have printed
   *"Nothing verified yet — new list every Thursday"*: a statement about the
   week's curation, used to describe a file that could not be read. Now
   `state.eventsFailed` is tracked separately and the Tonight empty state says
   which of the two it is.
2. **`initGoogleSignIn`'s callback: `if (data.ok) …` with no else, inside
   `catch (e) {}`.** Google had *already* authenticated the person — their own
   account chooser closed successfully — and then the app did nothing at all,
   on the same screen, with the same Sign in button sitting there. There is no
   way to read that except "the button is broken". Now says so, under the
   button, on both the rejected-credential and the network path.
3. **`signOut()`: `try { fetch(logout) } catch {}` then re-render
   unconditionally.** When it failed the cookie survived, the re-render read
   `/api/me`, got the same signed-in user back, and drew You exactly as it was.
   Pressing Sign out did visibly nothing and said nothing. Of all of these that
   is the one with real consequences — the whole point of the button is someone
   deciding they do not want to be signed in on this phone, and they walked
   away believing they were not. Now flashes **"Couldn't sign out — still
   signed in"** on the control they pressed. Verified both ways.
4. **Three `withChunk('owner', …)` call sites passed no `failEl`,** so a failed
   `js/owner.js` made "List your venue", "Manage" and "Pending venues" do
   literally nothing on tap — the outcome `withChunk`'s own comment was written
   to prevent ("a dead button is the worst outcome of a split like this, and it
   is the one that would not show up in testing on a fast connection"). They
   now flash **"Couldn't load — tap to retry"** on the button itself. The
   restore path detaches and re-attaches the *original child nodes* rather than
   saving `textContent` or `innerHTML`, because `.fl-manage-item` carries its
   own chevron and both shorter routes destroy it — verified the chevron and
   the exact `innerHTML` come back.
5. **`state.geoError` had six possible values and its two consumers covered
   four.** `LOCATE_LABELS` had no `failed` key, and the lookup falls back to
   `idle` — so a location attempt that *threw* put the pill back to "near me",
   which is what it says when nothing has been tried at all. The check-in
   button's chain sent `failed` and `unsupported` to *"Enable location to check
   in"*: advice to enable a permission already granted, and to enable one that
   does not exist on the device. Both maps now cover all six, and the set is
   written down once, at `requestLocation()`, for the next consumer.
6. **`'geolocation' in navigator`** was the guard in two places and is weaker
   than it reads — the property can exist and be unusable. One
   `hasGeolocation()` predicate now, so the pill's "hide myself" test and the
   request's "give up" test cannot disagree.
7. **Two unguarded `state.map.flyTo`.** `boot()` is explicitly written to carry
   on without maplibre, so `state.map` stays null whenever that CDN script
   404s, is blocked, or the device refuses a WebGL context — and one of those
   calls is the **last statement in `openVenue()`**. Reproduced: every venue tap
   threw `TypeError: Cannot read properties of null (reading 'flyTo')`, killing
   the rest of whatever handler opened the venue. The other, in `bindLocate()`,
   took the `updateCheckinButton()` call below it down with it, so a successful
   fix on a map-less load turned the pill green while the button still said
   "Enable location". Both guarded, both verified.
8. **`initMap()` itself was unguarded.** The library can be present and still
   refuse a WebGL context, which is not hypothetical on older Android. It is
   wrapped now — locally, not in `boot()`'s outer catch, which would abandon
   the deep link, the location request and the intro over a map Home does not
   need.
9. **`/api/me`'s "try again" had nothing to try it with.** Now a real button.

Left silent deliberately, each correctly: every `localStorage` /
`sessionStorage` guard (private browsing), every `navigator.permissions.query`
(not queryable for geolocation in some browsers), `navigator.share` (a
cancelled share throws), the `intro-seen` / `mood-intro-seen` / `mood-pick`
POSTs (documented best-effort, and an intro that reappears once is milder than
one that traps a broken request), the per-layer basemap paint calls, and the
two chunk *prefetches* whose real failure surfaces at the tap.

### C3 — no location permission at all

**Usable, and verified in full.** Home renders all 16 cards, every filter works,
venue sheets open, hours and links and the phone number are all there,
Directions is present. The "near me" pill reads **"location off"**, and tapping
it explains how to fix it, with the padlock instructions — which is better than
most apps manage. Distance sorting quietly falls back to editorial order.

Two things I changed, both about not lying:

- The venue sheet said **`tap "near me" for distance`** regardless of *why*
  there was no fix. When permission is blocked, that tap cannot produce a
  distance. It now reads `location off — tap "near me" to fix` for `blocked`
  (the tap *is* still the right next step — it opens the instructions) and
  `distance unavailable here` when there is no geolocation API at all.
- Directions with location blocked: the button label becomes "Location
  blocked". No error, no dead button. Already correct; verified.

### C4 — the splash could sit for 8 seconds over a finished app

Not a swallowed failure, but the same shape of harm, and I hit it while testing
the map. On a **first** visit `boot()` did `await mapSettled` before the mood
intro — and `mapSettled`'s timeout is 8s, which is the right patience for
deciding the basemap is gone and the wrong amount of time to hold a splash over
a Home screen that finished rendering in under a second. Measured with the
basemap unreachable: content at ~0.4s, splash up until 8.0s, then up to 4s more
for `preloadWelcomeSlides()`. Twelve seconds of loading spinner over a working
app, and a first-time visitor on a bad connection in Vientiane is exactly who
gets it.

The intro is a full-screen overlay and the map is on neither the screen it
covers nor the screen behind it. That wait is now capped at 2.5s
(`Promise.race`), long enough that a normal load still reveals the carousel
over a settled app. `mapSettled` is untouched and still shows the map warning
at 8s on its own.

### C5 — the Map tab with no map

`#mapWarning` says "the list still works", which is true and enough while the
list is on screen. On mobile it is not enough: tapping Map hides `#sheet`
entirely — and `#mapWarning` lives *inside* `#sheet`, so the one sentence
explaining the empty screen goes with it. Measured: a completely blank
viewport, no map, no list, no text, with only the bottom nav to escape.

`showMapUnavailable()` writes into `#map` itself, which is the element that is
actually empty, so it survives the sheet being hidden and needs no new markup
in `index.html`. Only ever called when there is **no map at all** — a map that
loaded but whose tiles failed still draws its canvas, markers and attribution,
and `#mapWarning` is the right notice for that. New copy measured: 16.7 / 15.02
on the heading, 5.98 / 4.75 on the body, night / day.

---

## D. Venue research → `data/candidates.json`, restaurants

**23 restaurants added**, under the same rules as the first batch, appended
below the existing 28 cafés and bars. Nothing touched `venues.json`, D1 or the
export script, and nothing in the repo references the file — re-verified by
grep. Every `hours` is `null`. No descriptions, no photos, no invented detail.

### The thing to read before the list

**None of them can be entered, and it is not a data problem.** `restaurant` is
not a venue type this app has:

- `functions/api/_venue-validation.js:15` — `VENUE_TYPES = ['bar','cafe','venue']`, so the API rejects it
- `js/app.js` — `COLORS` has no pin colour for it; `pinSVG()`'s `glyphKey`
  falls through to the generic 'venue' glyph; Home's `matchType()` knows only
  'bar' and 'cafe'
- `index.html` — no chip
- `css/style.css` — no `.marker.type-restaurant`, `:root` has no `--pin-restaurant`
- `js/owner.js` — the owner form's Bar/Café `.seg-btn` toggle has two options

Entering them as `venue` would work and would be wrong: `venue` is the
ITECC/mall/night-market bucket. Adding the type is a real change across six
files with **two design decisions inside it** — a pin colour that is not
already spoken for, and a glyph. That is your call, not a side effect of a
research pass, so I stopped and wrote it down instead.

### District, which you asked for

Facebook is still a wall: I re-tested `facebook.com/Kualao/` and it returns the
business name in English and Lao, and "Vientiane". No address, no district, no
phone, no hours, no closed marker. So district had to come from somewhere else,
and I used **OpenStreetMap's Nominatim search API** — a third-party
crowd-sourced record, a strong lead for "which district", and nothing more.

The rule I applied, which matters: **a result was accepted only when the
returned `display_name` actually contains the venue's name.** Nominatim
fuzzy-matches and returns confident-looking wrong answers — it gave "Lao Derm
Som Nguem" 19km north in Thangon for "Lao Derm", and "Mini Makphet" for
"Makphet". Both rejected, and both written into the file so the query is not
repeated and accepted next time.

**5 of 23 have a district** (Chanthabouly, Xaysetha ×2, Sikhottabong,
Sisattanak); 6 had no OSM entry at all, and OSM coverage in Vientiane is
patchy, so absence there says nothing about the venue. **The coordinates in
`osm` are not pins** — the file says so loudly, next to CLAUDE.md's rule that a
venue's lat/lng must be Kar-confirmed and a pending venue carries NULL rather
than a guess. They are there only so a place can be found in order to check it.

### One venue found, then found to be gone

**Doi Ka Noi is permanently closed.** Laotian Times, dated 14 May 2025: closed
after the death of its chef and owner. It was the first Lao restaurant to reach
Asia's 50 Best (no. 86, 2025) — and it is still being recommended by travel
listicles **dated September 2026**, sixteen months later. That is the best
single argument for the listicle rule I have found, so it is recorded in the
file as an exclusion rather than silently dropped. It is also the only positive
closure signal in 51 candidates across two batches, and it turned up in a news
post, not on the venue's own page — consistent with the first batch's finding
that the signals which would mark a venue closed sit on exactly the pages that
cannot be read.

### Other things worth more than the entries they are attached to

- **Le Padaek** has two OSM nodes ~120m apart, on Sisangvone and Saphangmo.
  Two branches, a stale duplicate, or a move — same trap as Naked Espresso.
- **Makphet** closed in 2017 over rent, reopened as *Mini* Makphet around 2019,
  and Tripadvisor carries a note from the team about relocating again. Which
  entity trades today, under which name, at which address, is unknown.
- **Kin Lom Chom View** displays as a Lao-Thai restaurant with the handle
  `warnmoubbqbuffet`. Usually a rebrand or two concepts on one page.
- **Kung's Cafe Lao was already in the file** from the café batch, under the
  same Facebook URL. Caught by the cross-check (URL *and* name, against both
  `venues.json`'s 30 ids and this file's own 28 rows), removed, and its OSM
  district folded into the row that was already there. That check is in the
  file because it earned its place.
- **Every `name_lo` is copied verbatim** from the page title in the search
  result, never transliterated — an unattended session cannot read Lao well
  enough to notice a wrong character, and a venue name with a typo in it is a
  venue nobody searching for it will find. A Lao speaker should still check
  each against the live page. Five I had approximated were corrected against
  the source before the file was written.

### Diff noise, so it does not surprise you

Re-serialising the JSON expanded 30 single-line `source` objects in the
*existing* entries onto multiple lines. No content changed — `git diff` will
show them as -/+ pairs.

---

## E. My own judgement — what I did instead of polish

Everything in §C2 and §C5 was found while testing, not on the list, and all of
it is "the app lies to you or does nothing" rather than "the app looks
slightly off". Two more, both small and both real:

- **`js/avatar.js`: picking an avatar never moved `aria-current`.** The markup
  sets `.sel` *and* `aria-current` together; the click handler moved only the
  class. So the ring followed your tap and the announced selection stayed on
  whatever was chosen last session, or on nothing. Exactly the
  written-in-two-places shape the last run catalogued, in code that run wrote
  to fix an accessibility gap. Fixed and verified across two picks.
- **`flashSurpriseMessage()` was one of two hand-rolled copies of "swap a label
  for 2.5s and put it back"**; it is now the one caller of a shared
  `flashLabel()` that also serves the three owner buttons and sign-out.

---

## What I could not verify

- **Any wall-clock timing, still.** Every tab driven through the browser
  tooling here reports `document.hidden === true`, so rAF is suspended, `mark()`
  never fires, and `setTimeout` is throttled. The 8s splash figure in §C4 is
  read off `mapSettled`'s own timeout constant and the observed ordering, not a
  stopwatch. Needs a device or a throttled DevTools trace.
- **WebKit.** All of it is Chromium. Nothing I changed touches the sticky
  behaviours this codebase has had Safari-only bugs in, but `.map-unavailable`'s
  `position:absolute; inset:0` inside `#map` is worth a glance on a real iPhone.
- **`geo=timeout`.** My shim replaced `getCurrentPosition` outright, so the
  browser's own `timeout: 4000` option never applied and the promise simply
  never settled. That is my harness, not the app — a real browser returns code
  3 and the pill says "try again". The `timeout` branch is covered by code
  inspection only.
- **The location-granted path.** Chrome has this origin permanently denied from
  the earlier tests, so `state.userPos` was never populated; the `userPos`
  branches of `updateCheckinButton()` and the travel line are unchanged code,
  but I did not see them render.
- **The Lao.** Still all of it, including `ກາງແຈ້ງ` on the open-air row and the
  23 new `name_lo` strings — copied, not composed, but unchecked.
- **Anything about the 23 restaurants beyond "a Facebook page with this name
  exists and is indexed as Vientiane", plus a district for 5 of them from
  OpenStreetMap.** No hours, no address from the venue itself, no phone, no
  price, and no trading status for any of them.
