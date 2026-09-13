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
