/* ============================================================
   Muan — phase 1
   Map + curated venues/events. No accounts, no check-ins yet.
   Check-ins, streaks and badges arrive in phase 2 (Workers + D1).
   ============================================================ */

// literal, hand-updated on every edit — there's no build step to stamp this
// automatically (see CLAUDE.md), so it's only as trustworthy as whoever
// last touched this file remembering to bump it. Logged by setDebugMode()
// below: if a phone's console shows an old value here, it's running cached
// JS/CSS and a fix genuinely never reached it — a real, distinct
// possibility "verified in Chromium" could never have caught. Bump this
// string whenever js/app.js or css/style.css change.
const BUILD_TIME = '2026-08-15T14:20:00Z';

// the very first thing this script does, before anything else — including
// COLORS below — has any chance to run, let alone touch the URL. Logged
// unconditionally (not just when true) so there's a console record either
// way of what the page actually saw at load, on a phone with no devtools
// to check this after the fact. See DEBUG_GEO further down: the tap-trigger
// there is the primary way to reach the debug panel now, this is kept
// working alongside it, not instead of it.
const DEBUG_FROM_URL = new URLSearchParams(location.search).get('debug') === '1';
console.log('[muan] ?debug=1 seen at script start:', DEBUG_FROM_URL);

/* ---------- venue types: ONE definition each ----------
   A venue type was previously spelled out in nine places — COLORS here,
   TILE_GLYPHS, venueTileUri()'s glyphKey ternary, MOOD_TYPES, matchType(),
   FILTER_ORDER, the section header in renderHomeSheet(), surpriseBtnHtml()'s
   label, the chips in index.html — plus VENUE_TYPES on the server and a
   Bar/Café/Venue toggle written twice in js/owner.js. Adding `restaurant` meant
   finding all of them, which is exactly the shape of bug CLAUDE.md's history
   is made of, so the things that ARE one fact now have one home.
   What lives here: the display name in both languages, the pin colour, the
   placeholder glyph key, and whether the type gets its own filter chip.
   What deliberately does NOT live here: anything a type does not share.
   `venue` is the ITECC/mall/night-market bucket and has no chip; `moods`
   belongs to MOOD_TYPES, which is a separate editorial list (only cafés have
   moods today).
   label_lo: 'ບາຣ໌' and 'ຄາເຟ' are Kar's own, from the chip row. 'ຮ້ານອາຫານ'
   is the standard compound for a restaurant and is how ~10 of the venues in
   data/candidates.json title their own Facebook pages, so it is attested
   rather than composed — but it is still not Kar's, and 'ສະຖານທີ່' for
   `venue` IS composed and has no UI using it yet (the owner form's Venue
   button is English-only). See TODO(lao). */
const VENUE_TYPE_META = {
  bar:        { label: 'Bars',        label_lo: 'ບາຣ໌',        one: 'Bar',        chip: true  },
  cafe:       { label: 'Cafes',       label_lo: 'ຄາເຟ',        one: 'Café',       chip: true  },
  // TODO(lao): 'ຮ້ານອາຫານ' is attested (see above) but unchecked by Kar.
  restaurant: { label: 'Restaurants', label_lo: 'ຮ້ານອາຫານ',   one: 'Restaurant', chip: true  },
  // TODO(lao): 'ສະຖານທີ່' is mine and unused — `venue` has no chip, and the
  // owner form's Venue button is English-only, so nothing renders it today.
  venue:      { label: 'Venues',      label_lo: 'ສະຖານທີ່',    one: 'Venue',      chip: false },
};
/* the types the owner forms offer, in button order. js/owner.js builds both
   of its type toggles (submit and edit) from this. `venue` stays in: both
   forms already offered it before restaurants, and dropping it would be a
   product change (and would leave an existing `venue` row's editor with no
   button selected) — whether owners should be able to pick it at all is
   listed as an open question for Kar in design/autonomous-run.md. */
const OWNER_VENUE_TYPES = ['bar', 'cafe', 'restaurant', 'venue'];

/* `event` is not a venue type — it is a marker variant (see pinSVG()), and
   it borrows the venue pin colour. Kept in the same map because that is what
   renderMarkers() indexes, but it has no entry in VENUE_TYPE_META. */
const COLORS = {
  bar: 'var(--pin-bar)', cafe: 'var(--pin-cafe)', restaurant: 'var(--pin-restaurant)',
  venue: 'var(--pin-venue)', event: 'var(--pin-venue)',
};
const VIENTIANE = { lng: 102.6030, lat: 17.9630 };
/* normal map fence — initMap() sets these, clearRoute() restores them after a
   route temporarily lifts the fence */
const MAP_BOUNDS = { maxBounds: [[102.45, 17.85], [102.82, 18.15]], minZoom: 12.4 };
// mobile Map tab: where a "fresh" arrival recentres to — the riverside
// venue cluster around central Vientiane, not wherever the camera happens
// to be sitting. See maybeRecenterMap(). The requested [102.6070, 17.9660]
// @ 14.2 clipped the "ວຽງຈັນ" (Vientiane) place label at a 390px-wide
// screen's right edge — the label itself renders at [102.6134, 17.9641]
// (queried via queryRenderedFeatures), east of the dense venue cluster
// around [102.605, 17.965]. Nudged east and out one notch so both the
// cluster and the full label sit comfortably in frame — verified against
// the actual mobile viewport width, not just the coordinates on paper.
const HOME_VIEW = { center: [102.6090, 17.9650], zoom: 14.0 };
const GOOGLE_CLIENT_ID = '768624583305-553qrbhib2mqbbi10ifsr18b8uqu4uvk.apps.googleusercontent.com';

const state = {
  venues: [],
  events: [],
  picks: null,
  filter: 'all',
  markers: [],
  userPos: null,
  geoError: null,
  userMarker: null,
  currentRouteGeometry: null,
  routeVenueId: null,     // set by showRoute(), cleared by clearRoute() — makes the routed venue sticky
  routeLabel: null,       // "X km · Y min drive", reused to restore the venue sheet without re-fetching
  map: null,
  selectedId: null,
  sheetView: { type: 'home', venueId: null },
  theme: null,
  tracking: null,
  trackWatchId: null,
  cafeTab: 'recommended', // 'recommended' | 'all' — sub-tab inside the Cafes filter
  distanceFilterM: null,  // null (Any) | 500 | 1000 | 3000 | 5000 — see withinDistance()
  homeQuery: '',          // the Discover search box — see wireHomeSearch()
  screen: 'home',           // mobile only: 'home' | 'map' | 'you' — see setMobileScreen()
  screenBeforeVenue: null,  // mobile only: screen to return to when the open venue closes
  venuePushed: false,       // mobile only: whether openVenue() pushed a history entry for the open venue
  geoAutoAttempted: false,  // boot()'s one silent location request — never retried automatically once this is true, see item 4 in the CLAUDE.md task this was written for
  avatarUrl: null,          // signed-in user's own uploaded profile picture ("<version>/<publicId>"), null = show the chibi instead — see applyAvatarUrl()
  weather: null,            // trimmed /api/weather response, or null before it resolves / on failure — see weatherWidgetHtml()
  eventsFailed: false,      // true when data/events.json could not be read at all. state.events is [] either way, and these two cases must NOT render the same sentence — see the Tonight empty state in renderHomeSheet()
};

const isMobile = () => window.innerWidth < 768;

/* "1 place" / "2 places" — the You screen's counts all go through this.
   "1 places · 1 check-ins" shipped because every count there was
   interpolated raw next to a hard-coded plural noun. */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// wraps every state.sheetView assignment so the mobile "pushed-over detail
// view" chrome (hides the bottom nav, lets #sheet cover the full screen —
// see the mobile screen-shell CSS in style.css) always stays in sync with
// what #sheetInner actually holds, no matter which of the many render
// functions (venue, avatar, owner forms, admin) put it there
const BASE_SHEET_VIEWS = ['home', 'flame', 'map'];  // 'map' has no #sheetInner content — see leaveVenue()
function setSheetView(view) {
  state.sheetView = view;
  document.getElementById('app')?.classList.toggle('sheet-detail', !BASE_SHEET_VIEWS.includes(view.type));
}

// mobile only: keeps state.screen (the bottom nav's active tab) and its
// chrome in sync. Called from renderHomeSheet()/openFlameSheet() themselves
// rather than only from the nav taps, so every path that ends up showing
// their content — a filter chip, the map's background tap, the venue back
// button, the post-checkin celebration — marks the right tab active without
// each call site needing to remember to. The Map tab has no content render
// of its own, so its nav handler calls this directly instead.
function setMobileScreen(screen) {
  state.screen = screen;
  const app = document.getElementById('app');
  if (app) app.dataset.screen = screen;
  document.querySelectorAll('#bottomNav .nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.nav === screen));
  placeChips();
}

// mobile only: leaves the currently-open venue (or any pushed-over detail
// view) and returns to the given screen — shared by the venue back-arrow/
// close buttons, tapping a bottom-nav tab while a venue is open, and the
// popstate handler for the hardware/browser back button (viaPopstate skips
// the history.replaceState below since the browser already moved us back)
function leaveVenue(screen, viaPopstate) {
  // captured before screenBeforeVenue is cleared below: true when this is a
  // genuine "back to where I opened this venue from" (the back arrow, or
  // hardware back), false when it's a deliberate jump to a different tab
  // while a venue happens to be open — only the latter counts as a "fresh"
  // Map arrival for maybeRecenterMap()
  const isReturnToSameScreen = screen === state.screenBeforeVenue;
  closeLightbox();  // a photo viewer left open over a venue survives every other exit path here — close it too
  stopTracking();
  state.selectedId = null; if (state.map) updateSelection();
  if (state.map) clearRoute();
  if (!viaPopstate && state.venuePushed) history.replaceState(null, '', location.pathname);
  state.venuePushed = false;
  state.screenBeforeVenue = null;
  if (screen === 'map') {
    // 'map' has no #sheetInner content of its own to render (unlike home/
    // flame below, whose render functions call setSheetView() themselves) —
    // clear the venue view directly or .sheet-detail stays stuck and the
    // bottom nav never comes back
    setSheetView({ type: 'map', venueId: null });
    setMobileScreen('map');
    if (state.map) {
      requestAnimationFrame(() => {
        state.map.resize();
        if (!isReturnToSameScreen) maybeRecenterMap();
      });
    }
  } else if (screen === 'you') {
    openFlameSheet();
  } else {
    renderHomeSheet();
  }
}

// mobile Map tab: recentres on HOME_VIEW (the riverside venue cluster),
// but only when there's nothing the user is mid-task with to knock off
// screen — a selected venue or a drawn route both mean "leave the camera
// alone" per the redesign brief. Callers are responsible for only invoking
// this on a genuinely fresh arrival (see the nav-tap handler and
// leaveVenue() above) — this function itself only checks the "is there
// something to disturb" half of that.
function maybeRecenterMap() {
  if (!state.map || state.selectedId || state.currentRouteGeometry) return;
  state.map.easeTo({ center: HOME_VIEW.center, zoom: HOME_VIEW.zoom });
}

// the You screen's "Open the map" invitation button (see flameInviteHtml()).
// Mobile has a Map screen to switch to, and does exactly what a Map tab tap
// does — including the resize + recentre, since arriving from You is always
// a fresh arrival. Desktop has no screens: the map is already on the page
// beside the sheet, so the only thing in the way is the You sheet itself,
// and going Home clears it.
function goToMap() {
  if (!isMobile()) { renderHomeSheet(); return; }
  setMobileScreen('map');
  setSheetView({ type: 'map', venueId: null });
  if (!state.map) return;
  requestAnimationFrame(() => { state.map.resize(); maybeRecenterMap(); });
}

/* ---------- geolocation ---------- */
// TEMP diagnostic — remove once the retry flow is confirmed working.
// ?debug=1 writes into a box in the sheet (phones have no devtools);
// otherwise it just goes to console.log.
//
// DEBUG_GEO is `let`, not `const`: the ?debug=1 route has already failed
// once for reasons nobody could pin down, so it's no longer the only way
// in — tapping the app logo 5x within 3s (see initDebugTapTrigger()) flips
// this at runtime too, and persists the choice in sessionStorage so it
// survives every Home/filter re-render for the rest of the tab's life, not
// just the current one. Nothing about the URL, no query string to strip or
// autocomplete wrong.
const DEBUG_STORAGE_KEY = 'muan-debug-panel';
function readDebugStorage() {
  try { return sessionStorage.getItem(DEBUG_STORAGE_KEY) === '1'; }
  catch (e) { return false; } // private-browsing/storage-disabled — fall back silently
}
let DEBUG_GEO = DEBUG_FROM_URL || readDebugStorage();

// single place that turns debug mode on/off after boot — keeps DEBUG_GEO,
// sessionStorage and the console record in sync no matter which of the two
// entry points changed it. Currently only gates geoDebug()'s on-screen box
// below; kept as its own function (rather than inlined at the two call
// sites) because it's cheap and this toggle will be worth having again.
function setDebugMode(on) {
  DEBUG_GEO = on;
  try { sessionStorage.setItem(DEBUG_STORAGE_KEY, on ? '1' : '0'); } catch (e) {}
  console.log('[muan] debug mode', on ? 'enabled' : 'disabled', '— build', BUILD_TIME);
}

// tap the app logo 5x within 3s to toggle debug mode — see DEBUG_GEO above
// for why this exists alongside ?debug=1 rather than replacing it
function initDebugTapTrigger() {
  const target = document.querySelector('.brand-pill');
  if (!target) return;
  let taps = [];
  target.addEventListener('click', () => {
    const now = Date.now();
    taps = taps.filter(t => now - t < 3000);
    taps.push(now);
    if (taps.length < 5) return;
    taps = [];
    setDebugMode(!DEBUG_GEO);
  });
}

function geoDebug(msg) {
  if (!DEBUG_GEO) { console.log(msg); return; }
  let box = document.getElementById('geoDebugBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'geoDebugBox';
    box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:35vh;overflow:auto;' +
      'background:#000;color:#0f0;font:11px/1.4 monospace;padding:6px 8px;z-index:9999;white-space:pre-wrap;';
    document.body.appendChild(box);
  }
  box.textContent += msg + '\n';
}

/* `'geolocation' in navigator` was the test in two places — here and in
   updateLocatePill() — and it is weaker than it reads: the property can
   exist and still be unusable. What actually matters is whether there is a
   function to call, so both sites ask that, through one predicate, and
   cannot drift apart. */
const hasGeolocation = () => typeof navigator.geolocation?.getCurrentPosition === 'function';

/* the one place that requests location — the "near me" pill and the
   Directions button both call this so their error handling can't drift
   apart.
   state.geoError is one of exactly six values, and EVERY consumer has to
   cover all six or a real failure renders as a resting state:
     null           no error (either no fix asked for yet, or we have one)
     'unsupported'  no geolocation API on this device
     'blocked'      PositionError.code 1 — permission denied
     'unavailable'  code 2 — no position source could answer
     'timeout'      code 3 — the fix took longer than the 4s option below
     'failed'       anything else that threw, including a non-PositionError
   'failed' is the one that used to fall through: LOCATE_LABELS had no entry
   for it, so the pill fell back to its idle "near me" label and a failed
   attempt was indistinguishable from never having tried. */
async function requestLocation() {
  if (!hasGeolocation()) {
    state.geoError = 'unsupported';
    updateLocatePill();
    return null;
  }
  if (navigator.permissions) {
    try {
      const perm = await navigator.permissions.query({ name: 'geolocation' });
      geoDebug(`[geo] permissions.state=${perm.state}`);
    } catch (e) { /* permissions API not queryable for geolocation in this browser */ }
  }
  try {
    // fast coarse fix (cell/wifi, usually well under a second) rather than
    // waiting on a cold GPS lock (up to 10s) — plenty for routing and for
    // the check-in radius (the server's, see state.checkinRadiusM). refineLocation() chases a sharper fix
    // afterwards in the background without making the caller wait for it.
    const pos = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false, timeout: 4000, maximumAge: 300000
      })
    );
    state.userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    state.geoError = null;
    geoDebug('[geo] coarse success');
    updateUserMarker();
    updateLocatePill();
    updateSelectedDistancePill();
    refineLocation();
    return state.userPos;
  } catch (err) {
    state.geoError =
      err.code === 1 ? 'blocked' :
      err.code === 2 ? 'unavailable' :
      err.code === 3 ? 'timeout' : 'failed';
    geoDebug(`[geo] error code=${err.code} message=${err.message}`);
    console.warn('geolocation', err.code, err.message);
    updateLocatePill();
    return null;
  }
}

// silent high-accuracy follow-up fired after requestLocation()'s coarse fix
// resolves — never awaited and never surfaced as loading state; if a sharper
// fix arrives it just quietly updates state.userPos and anything reading it
function refineLocation() {
  navigator.geolocation.getCurrentPosition(
    pos => {
      state.userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      geoDebug('[geo] refined (high-accuracy)');
      updateUserMarker();
      updateLocatePill();
      updateSelectedDistancePill();
      if (state.selectedId) {
        const v = venueById(state.selectedId);
        if (v) updateCheckinButton(v);
      }
    },
    err => geoDebug(`[geo] refine error code=${err.code}`),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

// called when a venue sheet opens with no fix yet, so a coarse position is
// usually already sitting in state.userPos by the time the user presses
// Directions. Only proceeds if permission is already granted — never
// triggers the browser's permission prompt; if it's 'prompt', 'denied', or
// unknown (the Permissions API doesn't cover geolocation in every browser),
// this just does nothing and the Directions/near-me buttons prompt properly
// on their own when the user actually asks.
async function warmLocation() {
  if (state.userPos || !('geolocation' in navigator) || !navigator.permissions) return;
  try {
    const perm = await navigator.permissions.query({ name: 'geolocation' });
    if (perm.state === 'granted') requestLocation();
  } catch (e) { /* permissions API not queryable for geolocation in this browser */ }
}

/* ---------- boot ---------- */
// chipBar is one persistent DOM node moved between #topbar (desktop),
// #sheet (mobile screens with no #chipSlot in their content), and a
// #chipSlot placeholder inside #sheetInner's own content (mobile Home —
// see setSheet()) rather than duplicated, so there's a single source of
// truth for which chip is active. Captured once via a module-level const
// rather than repeated getElementById() calls: #sheetInner's content gets
// wiped wholesale on every render (see setSheet()), which would detach
// chipBar from the document if it was nested inside at the time — after
// that, getElementById('chipBar') returns null since the node is no longer
// attached anywhere, but this reference still points at the live node and
// can reattach it regardless of where it currently sits.
const chipBarEl = document.getElementById('chipBar');
// chips are allowed in exactly two places, explicitly — never a fallback:
// mobile Home gets them via its own #chipSlot (set directly in setSheet(),
// not here); desktop always, and mobile's Map screen (but only when no
// detail view is pushed over it — a venue opened from a map marker keeps
// state.screen 'map' underneath), get them in #topbar. Every other view —
// You, venue detail, the owner editor, admin views, the submit form, the
// avatar picker — gets no chips at all, so the "else" here removes the bar
// rather than inserting it somewhere it'd still be visible (the bug: it
// used to fall back into #sheet, which is exactly what showed chips on the
// You screen, which has no #chipSlot of its own).
function placeChips() {
  const topbar = document.getElementById('topbar');
  const detailOpen = !BASE_SHEET_VIEWS.includes(state.sheetView.type);
  const chipsOnTopbar = !isMobile() || (state.screen === 'map' && !detailOpen);
  if (chipsOnTopbar) {
    if (!topbar.contains(chipBarEl)) topbar.appendChild(chipBarEl);
  } else if (chipBarEl.isConnected && !chipBarEl.closest('#sheetInner')) {
    // mobile Home nests chipBarEl inside #sheetInner's own content via
    // chipSlot.replaceWith() (see renderHomeSheet()) rather than through this
    // function — that placement is correct and must survive placeChips()
    // being re-run for an unrelated reason. Without this guard, any resize
    // event (window.addEventListener('resize', placeChips) below) ran this
    // branch, saw chipBarEl.isConnected (true, it's sitting in #sheetInner)
    // and chipsOnTopbar false (mobile, not map), and removed it anyway —
    // confirmed live: a resize fired seconds after boot, on Home, with no
    // window ever hitting the desktop breakpoint, and it yanked the bar out
    // for good (no source re-adds it outside a full renderHomeSheet() call).
    // Real phones fire resize for a lot more than a width change — address
    // bar collapse, keyboard open/close, orientation — so this wasn't rare.
    chipBarEl.remove();
  }
}

/* ---------- first-paint data: bundle now, live list a moment later ---------- */

// data/venues.json is a mirror of D1 refreshed by hand (scripts/export-venues.js),
// so it is right almost all of the time and wrong in exactly one way: an
// edit made to a venue since the last export. Rather than guess, compare
// the two properly once the live list lands.
//
// HOW "DIFFERS" IS DETECTED: a canonical fingerprint of the whole list —
// every object's keys sorted recursively, then JSON.stringify'd — compared
// as a single string. That is sensitive to every field of every venue: an
// edited closing hour, a corrected phone number, a flipped `verified`, a
// new photo id, a venue added, removed, or moved in the list. A length
// check (or an id-set check) would catch only additions and deletions and
// would sail straight past the far more common case, which is one field
// edited on a venue that was already there. Sorting the keys is what makes
// it safe to run on every load: the row -> object reassembly in
// functions/api/venues.js and rowToVenue() in scripts/export-venues.js
// build the same object deliberately, but property order is not part of
// what either promises, and an order-only difference is not a data
// difference — without the sort every load would "differ" and re-render for
// nothing. Cost is ~40 KB stringified twice, well under a millisecond, and
// it runs after the first paint either way.
function canonicalise(value) {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalise(value[k]);
    return out;
  }
  return value;
}
const venuesFingerprint = list => JSON.stringify(canonicalise(list));

// /api/venues excludes rejected submissions (see its SELECT); the mirror is
// a straight dump of the table with no such filter, so the same rule has to
// be applied here — otherwise the bundle would briefly show a venue the API
// never returns, and would register as a "differs" on every single load.
const publicVenues = list => (list || []).filter(v => v.pin_status !== 'rejected');

// swaps the bundle out for the live list, but only when it actually says
// something different. In the common case (mirror in sync with D1) this
// costs one string comparison and nothing on screen moves.
function refreshVenuesFromLive(live) {
  if (!live || !Array.isArray(live.venues)) {
    console.warn('[muan] live venues unavailable — staying on the bundled mirror');
    return;
  }
  /* an EMPTY list is a failure, never an answer. It used to be adopted like
     any other difference from the bundle, which replaced 30 venues with
     none and no message — a broken response indistinguishable from a real
     one, the shape of the August outage. functions/api/venues.js now turns
     zero rows into its stale fallback, but the client refuses it as well so
     no server version can do this. We ARE showing saved data at that point,
     so the stale banner is the true thing to say. */
  if (!live.venues.length) {
    console.error('[muan] /api/venues returned zero venues — treating as a failure, keeping the bundled mirror');
    showStaleWarning();
    return;
  }
  // the server's check-in radius (functions/api/_checkin-config.js) — kept
  // before the no-change early return below, since the radius arrives with
  // every live response whether or not the venues differ from the bundle
  if (Number.isFinite(live.checkin_radius_m) && live.checkin_radius_m !== state.checkinRadiusM) {
    state.checkinRadiusM = live.checkin_radius_m;
    if (state.sheetView.type === 'venue') {
      const open = venueById(state.sheetView.venueId);
      if (open) updateCheckinButton(open);
    }
  }
  // D1 threw and the Function served its own copy of the same mirror we are
  // already showing (see functions/api/venues.js) — no re-render to do, but
  // the data really may be out of date, so say so
  if (live.stale) showStaleWarning();
  const fresh = publicVenues(live.venues);
  if (venuesFingerprint(fresh) === venuesFingerprint(state.venues)) return;
  console.info('[muan] live venue data differs from the bundle — re-rendering');
  state.venues = fresh;
  syncTypeChips();
  renderMarkers();
  // only Home is safe to redraw from under the user: a venue detail, the
  // You screen or a half-filled owner form would lose its scroll position
  // (or its unsaved input) over a change the person may not even be looking
  // at. Every other view reads state.venues on its next render anyway.
  if (state.sheetView.type === 'home') renderHomeSheet();
}

// maplibre-gl.js is a ~830 KB classic <script>. Loaded synchronously ahead
// of this file — as it was until this pass — it gated every line of it:
// boot() could not start, so nothing could render, until the whole map
// library had downloaded and executed, on a screen where the list is the
// content and the map sits behind it. index.html loads it `async` now and
// this is the single point that waits for it. Resolves false rather than
// hanging if the tag is missing, the CDN is blocked, or it is still not
// there after 12s, so a dead unpkg costs the map and not the app.
function maplibreReady() {
  if (window.maplibregl) return Promise.resolve(true);
  const tag = document.getElementById('maplibre-js');
  if (!tag) return Promise.resolve(false);
  return Promise.race([
    new Promise(resolve => {
      tag.addEventListener('load', () => resolve(!!window.maplibregl), { once: true });
      tag.addEventListener('error', () => resolve(false), { once: true });
    }),
    new Promise(resolve => setTimeout(() => resolve(!!window.maplibregl), 12000)),
  ]);
}

// First-load instrumentation for "navigation -> venues on screen".
// performance.now() is already measured from navigation start in a
// top-level document, so a mark's own startTime is the number wanted and no
// arithmetic against window.__bootStart is needed. The requestAnimationFrame
// in the caller is what makes it honest: renderHomeSheet() only writes
// innerHTML, and the frame those cards are actually painted in is the next
// one. The two marks are separate on purpose — the cards exist at the
// first, but #splash is still opaque over them until the second.
function mark(name) {
  requestAnimationFrame(() => {
    performance.mark(name);
    const t = performance.getEntriesByName(name).pop()?.startTime ?? performance.now();
    console.info(`[muan] ${name} at ${Math.round(t)}ms from navigation`);
  });
}

async function boot() {
  try {
    // captured before anything else touches the URL — renderHomeSheet()
    // (called below, well before the deep-link check further down) always
    // clears the query string back to location.pathname when it renders
    // Home, which is correct for its other callers (closing a venue,
    // tapping a nav tab) but wipes a ?v=<id> deep link before boot ever
    // gets to read it. Reading location.search any later than this line
    // returns empty, which is exactly what broke every share link.
    const deepLinkId = new URLSearchParams(location.search).get('v');

    placeChips();
    window.addEventListener('resize', placeChips);
    initDebugTapTrigger();  // 5 taps on the logo within 3s — see DEBUG_GEO above
    // FIRST PAINT COMES OFF THE BUNDLE, NOT THE DATABASE. Everything
    // awaited here is a static file on the Pages edge, already requested
    // from index.html's <head> (window.__boot) before this script had even
    // finished downloading — so by the time this line runs they are
    // typically resolved and the list renders in the same tick. /api/venues
    // is a Worker invocation and a D1 query behind that; it is started at
    // the same moment but deliberately not awaited, and reconciled against
    // the bundle by refreshVenuesFromLive() further down.
    const pre = window.__boot || {};
    const livePromise = (pre.live || fetch('/api/venues').then(r => r.json()))
      .catch(e => { console.warn('[muan] live venues fetch failed', e); return null; });

    /* These three used to be one Promise.all whose rejection fell through to
       boot()'s catch, which logs and dismisses the splash. The result of ANY
       of the three failing was therefore the same thing: the splash lifts on
       an app with no venues, no events, no message and no retry — a blank
       screen whose only record was a console.error nobody on a phone can
       read. Measured, with the live /api/venues perfectly healthy: a 500 on
       data/venues.json alone rendered 0 cards and an empty sheet.
       They are settled separately now because they do not fail the same way:
         - venues are the content. The bundle and /api/venues are two
           independent copies of the SAME list, and boot needs either one, so
           a failed bundle falls through to the live promise that is already
           in flight instead of taking the app down with it. If BOTH are gone
           there is nothing to show and that is said out loud.
         - events and picks are not content. A failure there must not cost
           anyone the venue list — but it must not quietly read as "nothing
           on tonight" either (see state.eventsFailed below). */
    const picksPromise = (pre.picks || fetch('data/picks.json')
      .then(r => (r.ok ? r.json() : null)))
      .catch(e => { console.warn('[muan] picks unavailable', e); return null; });

    let bundle = null;
    try {
      bundle = await (pre.venues || fetch('data/venues.json').then(r => r.json()));
    } catch (e) {
      console.warn('[muan] bundled venues unavailable — falling back to /api/venues', e);
    }
    if (!bundle || !Array.isArray(bundle.venues)) {
      // livePromise already resolves to null on failure, so this cannot throw
      const live = await livePromise;
      // non-empty, not just an array — see refreshVenuesFromLive()
      if (live && Array.isArray(live.venues) && live.venues.length) {
        bundle = live;
        // the live list IS the mirror when D1 threw (see functions/api/
        // venues.js) — same reason refreshVenuesFromLive() says so
        if (live.stale) showStaleWarning();
      }
    }

    let eData = null;
    try {
      eData = await (pre.events || fetch('data/events.json').then(r => r.json()));
    } catch (e) {
      console.warn('[muan] events unavailable', e);
    }
    const picks = await picksPromise;

    state.venues = bundle ? publicVenues(bundle.venues) : [];
    syncTypeChips();
    // eventExpired(), not isPast(ev.date): a weekly fixture's own `date`
    // is the night its source verified and goes past almost immediately,
    // while the event itself has not ended. See eventDate() at the bottom.
    state.events = eData ? eData.events.filter(ev => !eventExpired(ev)) : [];
    /* The flag, not just the empty array. "No events loaded" and "no events
       on this week" are different facts and the Tonight section's empty
       state says a specific thing about the second one ("Nothing verified
       yet — new list every Thursday"), which would be a lie about the
       first. This is the pattern fetchMyVenues() already guards against and
       that the migration-010 outage hid behind. */
    state.eventsFailed = !eData;
    state.picks = picks;

    initTheme();
    document.querySelector('.brand-mark').innerHTML = logoMark(17, 'var(--ink2)');
    document.getElementById('locateIcon').innerHTML = icoLocate(15);
    document.getElementById('navHomeIcon').innerHTML = icoHomeNav(21);
    document.getElementById('navMapIcon').innerHTML = icoMapNav(21);
    document.getElementById('navYouIcon').innerHTML = icoPersonNav(21);
    bindTheme();
    refreshAvatarBtn();
    document.getElementById('avatarBtn').addEventListener('click', openFlameSheet);
    // kept as a promise (not fire-and-forget) since shouldShowMoodIntro()
    // further down needs its result too — the avatar use below still
    // doesn't block or delay anything else in boot(); a signed-out visitor
    // just gets signed_out:true back and the button stays on the chibi/
    // emoji fallback it already shows.
    const mePromise = fetch('/api/me').then(r => r.json()).catch(() => ({ ok: false }));
    mePromise.then(me => {
      if (me?.ok && !me.signed_out) applyAvatarUrl(me.avatar_url || null);
    });
    // renderHomeSheet() before the map, not after: the list is the content
    // of the first screen and needs neither tiles nor maplibre-gl.js, which
    // is still downloading at this point (see maplibreReady(), called below
    // once every binding is in place).
    if (!bundle) {
      /* Both venue sources are gone — the bundled mirror AND /api/venues.
         There is no list to draw, so the one thing that must not happen is
         the splash lifting on a blank screen (which is exactly what did
         happen before this block existed). Deliberately placed AFTER the
         theme, the nav and the header are wired: the app frame still works,
         the theme toggle still works, and only the content is missing —
         which is the truth. Nothing below this line has anything to render
         from, so it returns; boot()'s finally still drops the splash. */
      showDataFailure();
      return;
    }

    renderHomeSheet();
    mark('muan:venues-rendered');

    // fire-and-forget, not in the Promise.all above with venues/events/picks
    // — weather is decoration (see weatherWidgetHtml()), not content the
    // Home screen needs to be usable, so it must never be able to delay the
    // first paint the way a slow/stalled venues or events response would be
    // right to. Same "never surface a failure" contract as picks: a
    // rejected promise and a well-formed {ok:false} body both collapse to
    // null, and weatherWidgetHtml() already treats null as "render
    // nothing". Deliberately does NOT call renderHomeSheet() to show it —
    // that would replace #sheetInner's whole innerHTML and restart the
    // entrance animation on every card on screen just to reveal one bar.
    // Instead it inserts the widget's own markup directly into .s-subrow,
    // the flex row it now shares with the Home subhead (see renderHomeSheet()
    // and .s-subrow in style.css) — appended, so it lands on that row's right
    // edge exactly where the synchronous render would have put it. The row is
    // always present on Home whether or not weather resolved, and unlike
    // #chipBar it is never re-homed by placeChips(), so it needs no fallback
    // anchor chain. Was inserted before #chipSentinel, above the chip row,
    // back when the widget was a 40px bar of its own; arriving late then
    // pushed everything below it down by that height, and now moves nothing
    // at all — the row is already at its final height. Shown on every Home
    // tab now (Bars/Cafes included — the widget moving into flow means it no
    // longer collides with .surprise-btn there), so no filter check is
    // needed any more. Guarded the same as requestLocation() below (still on Home),
    // and against a #sheetInner that's already been re-rendered since this
    // fetch started (a filter switch, or requestLocation() below landing
    // first), which would insert the bar into a *different* screen's content.
    fetch('/api/weather')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('weather fetch failed: ' + r.status)))
      .then(d => (d?.ok ? d : null))
      .catch(e => { console.warn('[muan] weather unavailable', e); return null; })
      .then(w => {
        state.weather = w;
        if (!w || state.sheetView.type !== 'home') return;
        const inner = document.getElementById('sheetInner');
        const subRow = inner && inner.querySelector('.s-subrow');
        if (subRow && !inner.querySelector('.weather-bar')) {
          subRow.insertAdjacentHTML('beforeend', weatherWidgetHtml());
        }
      });

    // item 4: sorting now depends on state.userPos by default, so ask once,
    // quietly, on first load instead of waiting for a button tap (this IS
    // the browser's native permission prompt if the user hasn't decided
    // yet — "quiet"/"not aggressive" means no custom nag dialog of our own
    // first, no retry loop, not that the OS prompt itself is skipped).
    // Never blocks the initial render — requestLocation() can take up to
    // its own 4s timeout, so the curated/no-location view paints first and
    // this only re-renders Home if a position actually comes back and the
    // user is still looking at it. geoAutoAttempted guarantees exactly one
    // attempt per session: denied/unavailable/timeout all fall back to the
    // curated order with nothing said about it, and nothing here asks again.
    if (!state.geoAutoAttempted) {
      state.geoAutoAttempted = true;
      requestLocation().then(pos => {
        if (pos && state.sheetView.type === 'home') renderHomeSheet();
      });
    }

    bindChips();
    bindLocate();
    bindRouteBar();
    bindMapWarning();
    bindStaleWarning();
    // the live list arrives whenever it arrives — the app has been usable
    // off the bundle since renderHomeSheet() above
    livePromise.then(refreshVenuesFromLive);
    initSheetDrag();

    // mobile bottom nav — tapping a tab while a venue is open closes it via
    // the same leaveVenue() path as its own back arrow; otherwise Home/You
    // re-render their content (which also marks themselves active — see
    // setMobileScreen()) while Map, which has no content of its own to
    // render, just switches the screen and resizes the map (see MAPLIBRE
    // HAZARD note above initMap())
    document.querySelectorAll('#bottomNav .nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.nav;
        // defensive: the nav is hidden while an owner form is open (the forms
        // are sheet-detail screens), but if that ever changes, Home and You
        // replace the sheet and must ask first. Map re-renders nothing.
        if (target !== 'map' && typeof edBlocksLeave === 'function' && edBlocksLeave(() => btn.click())) return;
        if (state.sheetView.type === 'venue') { leaveVenue(target); return; }
        if (target === 'map') {
          const arrivingFresh = state.screen !== 'map';
          setMobileScreen('map');
          if (state.map) {
            requestAnimationFrame(() => {
              state.map.resize();
              if (arrivingFresh) maybeRecenterMap();
            });
          }
        } else if (target === 'you') {
          stopTracking(); if (state.map) clearRoute();
          openFlameSheet();
        } else {
          stopTracking(); if (state.map) clearRoute();
          renderHomeSheet();
        }
      });
    });

    // mobile hardware/browser back button: closes an open venue (popping
    // the history entry openVenue() pushed for it) instead of leaving the
    // app. Tab switches (Home/Map/You) never push a history entry, so
    // pressing back from a tab is unchanged from before this pass — it
    // still exits, since there was never anything to pop.
    window.addEventListener('popstate', () => {
      if (isMobile() && state.sheetView.type === 'venue' && state.venuePushed) {
        leaveVenue(state.screenBeforeVenue || 'home', true);
      }
    });

    const st = document.getElementById('sheetToggle');
    st.addEventListener('click', () => {
      toggleSheet();
      st.textContent = document.getElementById('sheet').classList.contains('collapsed') ? '›' : '‹';
    });
    // restore last state on load, but only for the home sheet
    if (localStorage.getItem('psd-sheet-collapsed') === '1') { toggleSheet(true); st.textContent = '›'; }

    document.addEventListener('click', (e) => {
      if (window.innerWidth >= 768) return;          // desktop uses the tab
      const sheet = document.getElementById('sheet');
      if (!sheet) return;
      // tapping the handle always toggles
      if (e.target.closest('#sheetHandle')) { toggleSheet(); return; }
      // when collapsed, tapping anywhere on the sheet expands it
      if (sheet.classList.contains('collapsed') && e.target.closest('#sheet')) {
        toggleSheet(false);
      }
    });

    // Nothing below this line is something the splash is covering for. For
    // a return visitor there is no intro to mount, so Home — rendered and
    // fully bound by now — is what is behind the splash, and it comes off
    // here rather than at the end of boot(). That matters more than it
    // sounds: everything after this point waits on the 830 KB map library
    // and then on basemap tiles, so leaving the splash to the finally block
    // meant a list that had finished rendering at half a second stayed
    // invisible for several more. moodIntroPossible() is checked once and
    // reused below so the two decisions can't disagree.
    const introPending = moodIntroPossible();
    if (!introPending) dismissSplash();

    // the one point in the app that has to wait for maplibre-gl.js —
    // placed after renderHomeSheet() and after every binding above, so the
    // list is on screen and interactive while the library is still coming
    // down. Everything else that touches `maplibregl` is either reached
    // from initMap() or guarded on state.map.
    if (await maplibreReady()) {
      /* initMap() can throw for a reason maplibreReady() cannot see: the
         library is there but the device will not give it a WebGL context.
         That is not hypothetical on the older Android phones this app is
         for. Caught here rather than in boot()'s outer catch, because the
         outer catch would abandon everything below this line — the deep
         link, the location request, the intro — over a map that the Home
         screen does not need. */
      try {
        initMap();
      } catch (err) {
        console.warn('[muan] map failed to initialise — continuing without it', err);
        state.map = null;
        showMapWarning();
        showMapUnavailable();
      }
    } else {
      console.warn('[muan] maplibre-gl.js unavailable — continuing without the map');
      showMapWarning();
      showMapUnavailable();
    }

    const vid = deepLinkId;
    if (vid && venueById(vid)) {
      openVenue(vid);
      const dv = venueById(vid);
      // a deep link can point at a pending venue (e.g. an owner sharing
      // their own submission) — no lat/lng to fly to yet
      if (state.map && dv.lat != null && dv.lng != null) {
        state.map.flyTo({ center: [dv.lng, dv.lat], zoom: 15.5 });
      }
    }

    // never let a stuck basemap (CDN outage, blocked domain, ad-blocker,
    // flaky connection) hold the splash — or the rest of the app — hostage.
    // The sheet/list/gallery don't need tiles at all, so race the real load
    // against a timeout rather than awaiting it unconditionally
    // Kept as a promise now instead of an inline await. This wait was the
    // reason a list that had finished rendering at ~0.5s still sat behind
    // an opaque splash until the basemap tiles arrived — the bundle-first
    // work above would have bought nothing user-visible while it stood.
    const mapSettled = !state.map ? Promise.resolve() : Promise.race([
      new Promise(resolve => state.map.once('load', () => resolve(false))),
      new Promise(resolve => setTimeout(() => {
        console.warn('[muan] map load timed out after 8s — continuing without it');
        resolve(true);
      }, 8000)),
    ]).then(timedOut => { if (timedOut) showMapWarning(); });

    // one-time first-open intro flow — mounted here, right before the
    // finally block's dismissSplash(), so it's the first thing revealed as
    // the splash fades rather than Home. preloadWelcomeSlides() is awaited
    // too (capped at 4s) so the carousel never opens mid-load — the
    // splash's own loader stays up and covers for it (#splash is z-index
    // 999, above .mood-intro's 900) rather than flashing Home before the
    // intro pops in late.
    //
    // moodIntroPossible() is the half of shouldShowMoodIntro() that can be
    // answered with no network round trip at all. When it says no — every
    // return visit, which is nearly every visit — there is nothing left
    // that needs the splash, so both the map wait and the /api/me read are
    // skipped and the finally block drops the splash as soon as Home has
    // painted. Only a genuine first-time visitor still pays for them, and
    // for them the wait is buying something they will actually see.
    if (introPending) {
      /* capped, not `await mapSettled` outright. mapSettled's own timeout is
         8s, which is the right patience for deciding the basemap is gone —
         but it was also how long the SPLASH sat there, on a first visit,
         over a Home screen that had finished rendering in under a second.
         Measured with the basemap unreachable: content at ~0.4s, splash up
         until 8.0s, then up to 4s more for preloadWelcomeSlides(). Twelve
         seconds of loading spinner over a working app, and a first-time
         visitor on a bad connection in Vientiane is exactly who gets it.
         The intro is a full-screen overlay; the map is not on the screen it
         covers and not on the screen behind it (Home is the list). So this
         waits only long enough that a normal load still reveals the
         carousel over a settled app, and gives up well before the map's own
         patience runs out. mapSettled is untouched and still shows the map
         warning at 8s on its own. */
      await Promise.race([mapSettled, new Promise(r => setTimeout(r, 2500))]);
      const me = await mePromise;
      if (shouldShowMoodIntro(me)) {
        await preloadWelcomeSlides();
        showMoodIntro();
      }
    }
  } catch (err) {
    console.error('[muan] boot failed', err);
  } finally {
    // must run whether boot succeeded, threw, or the map never loaded —
    // a splash that never leaves is worse than an unpolished one
    dismissSplash();
  }
}

let splashDismissed = false;
function dismissSplash() {
  // boot() drops the splash as soon as Home is up on the fast path, and its
  // finally block drops it again for the paths that don't — whichever gets
  // here first owns the fade; a second call must not restart it
  if (splashDismissed) return;
  splashDismissed = true;
  const splash = document.getElementById('splash');
  if (!splash) return;
  const MIN_MS = 600;                    // avoid a jarring flash on fast loads
  const wait = Math.max(0, MIN_MS - (performance.now() - window.__bootStart));
  setTimeout(() => {
    splash.classList.add('gone');
    // the venues were rendered at muan:venues-rendered but nobody could see
    // them until this line — #splash is opaque and covers the whole viewport
    mark('muan:splash-lifting');
    setTimeout(() => splash.remove(), 500);
  }, wait);
}

/* ---------- theme ---------- */
/* Both themes are CARTO VECTOR styles now. Night used to be the raster
   basemap `{a,b,c}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png`, built
   by hand into a style object below, and that endpoint no longer serves a
   usable tile: CARTO has moved its raster basemaps behind an API key and now
   stamps every unauthenticated tile with "API KEY REQUIRED" and
   "carto.com/basemaps/apikey" diagonally across the image. Verified
   2026-09-15 by fetching the app's exact URL — HTTP 200, a real map, and the
   watermark burnt into the pixels. Byte-identical with and without a
   Referer, on all three subdomains, so there was nothing to configure our
   way out of. Night is the DEFAULT theme after 17:00 and this app is about
   where to go tonight, so that watermark was what most people saw.
   Dark Matter is CARTO's own vector equivalent of dark_all and it reads the
   SAME source Positron already reads — carto.streets/v1 — which is not
   watermarked (checked the decompressed .mvt: no "API KEY", no "apikey", no
   "carto.com"). So this is the provider's supported replacement for the
   thing that broke, not a change of basemap.
   Attribution still holds (CLAUDE.md — keep the attribution control): the
   vector tilejson carries "© CARTO, © OpenStreetMap contributors" itself, so
   the hardcoded attribution string the raster style needed is gone WITH the
   raster style rather than left behind to drift.
   If a CARTO API key is ever added, raster is the thing it would buy back —
   but day has been vector all along and nothing about it needed raster. */
const DARK_STYLE_URL  = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const LIGHT_STYLE_URL = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

function resolvedTheme() {
  const pref = localStorage.getItem('muan-theme') || 'auto';
  if (pref !== 'auto') return pref;
  const h = new Date().getHours();
  return (h >= 17 || h < 6) ? 'dark' : 'light';
}

function mapStyle(theme) {
  return theme === 'light' ? LIGHT_STYLE_URL : DARK_STYLE_URL;
}

/* sun/moon track the RESOLVED theme (light/dark), not the 3-way auto/light/dark
   preference the label shows — icons inherit colour from the pill via currentColor */
function updateThemeIcon(theme) {
  const icon = document.getElementById('themeIcon');
  if (icon) icon.innerHTML = theme === 'light' ? icoSun(15) : icoMoon(15);
}

function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  document.getElementById('themeLabel').textContent =
    (localStorage.getItem('muan-theme') || 'auto') === 'auto' ? 'auto' : theme;
  updateThemeIcon(theme);
  if (state.map && state.theme !== theme) state.map.setStyle(mapStyle(theme));
  state.theme = theme;
}

/* boot() calls this instead of applyTheme() for the very first paint — the
   inline pre-paint script in index.html already set data-theme before any
   stylesheet loaded, so re-deriving it here from scratch risks landing on a
   different value and causing the exact flash that script exists to avoid.
   Falls back to resolvedTheme() only if that attribute is missing or isn't
   a real theme (guards the literal 'auto' value the toggle can still write
   to localStorage, which the pre-paint script doesn't resolve further). */
function initTheme() {
  const preset = document.documentElement.dataset.theme;
  const theme = (preset === 'light' || preset === 'dark') ? preset : resolvedTheme();
  document.documentElement.dataset.theme = theme;
  document.getElementById('themeLabel').textContent =
    (localStorage.getItem('muan-theme') || 'auto') === 'auto' ? 'auto' : theme;
  updateThemeIcon(theme);
  state.theme = theme;
}

const AVATARS = ['#E8B98A|#1C1726','#C98E6B|#131019','#E8B98A|#7C5CE0','#C98E6B|#1FBF9C','#8A5A3B|#FF5A3C','#E8B98A|#FFC24B'];

/* items mark places visited, not consumption — computed from checkins, never stored */
const ITEMS = [
  { id:'coffee', type:'cafe',  need:3,  name:'Coffee cup',   name_lo:'ຈອກກາເຟ', where:'cafés' },
  { id:'beer',   type:'bar',   need:3,  name:'Beer mug',     name_lo:'ຈອກເບຍ', where:'bars' },
  { id:'ticket', type:'venue', need:3,  name:'Ticket stub',  name_lo:'ປີ້', where:'markets' },
  { id:'crown',  type:'any',   need:20, name:'Explorer cap', name_lo:'ໝວກນັກສຳຫຼວດ', where:'places' },
];

/* distinct venues visited per type — the unit items are earned in (a second
   visit to the same cafe never counts twice). `any` is the distinct-venue
   total, and can share this object with the real types because no venue is
   ever of type 'any'. */
function visitedTypeCounts(venueCounts) {
  const visitedIds = Object.keys(venueCounts);
  const counts = { cafe:0, bar:0, venue:0, any: visitedIds.length };
  visitedIds.forEach(id => {
    const v = venueById(id);
    if (v && counts[v.type] !== undefined) counts[v.type]++;
  });
  return counts;
}

/* every item with its progress, locked ones included — the You screen draws
   the empty slots too, since a reward nobody can see isn't a reward: the
   old screen only ever passed earned ids to avatarSVG(), so a new user's
   chibi was bare with nothing on screen saying what would fill it. `have`
   is clamped to `need` so a 40-venue explorer reads "20/20", not "40/20". */
function itemProgress(venueCounts) {
  const counts = visitedTypeCounts(venueCounts);
  return ITEMS.map(it => {
    const have = Math.min(counts[it.type], it.need);
    return { ...it, have, earned: have >= it.need };
  });
}

function earnedItems(venueCounts) {
  return itemProgress(venueCounts).filter(it => it.earned);
}

/* must stay in sync with RIVERSIDE_VENUES in functions/api/checkin.js */
const RIVERSIDE = [
  'chokdee-cafe', 'sinouk-khemkhong', 'night-street',
  'vte-night-market', 'baron', 'mahasan', 'rustic-white', 'seventh-heaven'
];

const total = c => Object.values(c).reduce((a,b) => a+b, 0);

/* mirrors the seeded badges table (migrations/003_badges.sql) — progress
   hints only, the server is the source of truth for whether a badge is earned */
const BADGES = [
  { id:'first-fire', name:'First Fire', icon:'🔥',
    progress: c => ({ have: Math.min(1, total(c)), need: 1, hint: 'check in anywhere' }) },
  { id:'explorer', name:'Explorer', icon:'🧭',
    progress: c => ({ have: Object.keys(c).length, need: 10, hint: 'different places' }) },
  { id:'regular', name:'Regular', icon:'🪑',
    progress: c => { const best = Math.max(0, ...Object.values(c));
      return { have: best, need: 5, hint: 'visits to one place' }; } },
  { id:'riverside', name:'Riverside', icon:'🌊',
    progress: c => ({ have: RIVERSIDE.filter(id => c[id]).length, need: 3,
      hint: 'riverside places' }) },
  { id:'night-owl', name:'Night Owl', icon:'🌙',
    progress: () => ({ have: 0, need: 1, hint: 'check in after midnight' }) },
];

/* items sit in their own quadrant so they never overlap: ticket upper-left
   chest, beer lower-left, coffee lower-right, cap layered over the hair */
const ITEM_LAYERS = {
  ticket: `<g>
    <rect x="12" y="28.5" width="7" height="7" rx="1" fill="var(--gold)"/>
    <circle cx="12" cy="32" r="1" fill="var(--ink3)"/>
  </g>`,
  beer: `<g>
    <rect x="10" y="36" width="6" height="6" rx="1" fill="#C97A1F"/>
    <rect x="10" y="35" width="6" height="2" rx="1" fill="#FFF6E8"/>
    <path d="M16 37 q2 0 2 1.5 q0 1.5 -2 1.5" fill="none" stroke="#C97A1F" stroke-width="1"/>
  </g>`,
  coffee: `<g>
    <rect x="28" y="35" width="6" height="6" rx="1" fill="var(--bone)"/>
    <rect x="28" y="35" width="6" height="1.4" fill="#131019"/>
    <path d="M34 37 q2 0 2 1.5 q0 1.5 -2 1.5" fill="none" stroke="var(--bone)" stroke-width="1"/>
  </g>`,
  crown: `<g>
    <path d="M12 8 C12 3 16 1 22 1 C28 1 32 3 32 8 L32 9.5 C26 6.5 18 6.5 12 9.5 Z" fill="var(--gold)"/>
  </g>`,
};

/* the same ITEM_LAYERS drawings, cropped to just that item, so the You
   screen's slot chips and the chibi can never show two different pictures
   of one item — each box is the layer's own bbox in the 44x44 avatar
   space, padded a touch so a stroke isn't clipped at the edge */
const ITEM_VIEWBOX = {
  ticket: '11 27.5 9.5 9.5',
  beer:   '9 34 10.5 9',
  coffee: '27 34 10.5 9',
  crown:  '11 0 22 11',
};

/* one item drawn on its own, for the slot chips. Locked slots use the same
   artwork and are dimmed by .fl-item.locked in CSS rather than by a second
   set of greyed drawings — one picture per item, so a slot and the chibi
   can't drift apart. */
function itemIconSVG(id, size) {
  return `<svg viewBox="${ITEM_VIEWBOX[id]}" width="${size}" height="${size}" aria-hidden="true">
    ${ITEM_LAYERS[id]}
  </svg>`;
}

function avatarSVG(i, size, itemIds) {
  itemIds = itemIds || [];
  const [skin, shirt] = AVATARS[i].split('|');
  return `<svg viewBox="0 0 44 44" width="${size}" height="${size}">
    <circle cx="22" cy="22" r="21" fill="var(--ink3)"/>
    <path d="M9 44 C9 32 15 26 22 26 C29 26 35 32 35 44 Z" fill="${shirt}"/>
    <circle cx="22" cy="15" r="11" fill="${skin}"/>
    <path d="M11 15 C11 6 16 3 22 3 C28 3 33 6 33 15 C33 11 28 9 22 9 C16 9 11 11 11 15 Z" fill="#131019"/>
    <ellipse cx="17" cy="19" rx="1.8" ry="2.6" fill="#131019"/>
    <ellipse cx="27" cy="19" rx="1.8" ry="2.6" fill="#131019"/>
    <path d="M20 22.5 Q22 24.4 24 22.5 Q22 23.6 20 22.5 Z" fill="#131019"/>
    ${itemIds.includes('ticket') ? ITEM_LAYERS.ticket : ''}
    ${itemIds.includes('beer') ? ITEM_LAYERS.beer : ''}
    ${itemIds.includes('coffee') ? ITEM_LAYERS.coffee : ''}
    ${itemIds.includes('crown') ? ITEM_LAYERS.crown : ''}
  </svg>`;
}
// the top-right button shows the user's own uploaded photo when they have
// one (state.avatarUrl, kept current by applyAvatarUrl() below), and only
// falls back to the existing chibi/emoji when they don't — the one place
// (besides the You screen header, rendered directly in
// renderFlameSheetBody()) the real photo is allowed to appear; it never
// shows anywhere the chibi itself appears (comments/friends later)
function refreshAvatarBtn() {
  const slot = document.getElementById('avatarSlot');
  if (state.avatarUrl) {
    slot.innerHTML = `<img src="${esc(cloudinaryAvatarUrl(state.avatarUrl, 40))}" alt="">`;
    return;
  }
  const i = localStorage.getItem('muan-avatar');
  slot.innerHTML = i !== null ? avatarSVG(+i, 20) : '😊';
}

// single funnel for every place that learns the current profile-picture
// value (boot's own /api/me check, opening the flame sheet, a fresh
// upload, signing out) so the top-right button never drifts out of sync
function applyAvatarUrl(url) {
  state.avatarUrl = url;
  refreshAvatarBtn();
}

/* ---------- on-demand code chunks ----------
   Same idea as loadGoogleSignIn() below, applied to this app's own code:
   inject a <script> the first time something actually needs it, and cache the
   promise so a second caller waits on the same load instead of starting a
   second one.

   Why this exists: js/app.js was 323KB and was the only thing between the
   page and the first venue — index.html has already fetched data/venues.json
   and the stylesheets before app.js has finished downloading (see the head
   script), so on a phone the whole critical path was this one file's
   download, parse and compile. 59KB of it — 18% — was the avatar picker, the
   two owner forms, the admin pending queue and the photo uploader: code that
   lives entirely on the You screen and that most visitors will never reach.
   None of it is on the boot path, so none of it needs to be in the file that
   gates first paint.

   The chunks are CLASSIC scripts, not modules. Classic scripts share one
   global lexical scope, so the moved code still resolves esc(), setSheet(),
   state, openFlameSheet() and everything else out of app.js by name and not
   a line of it had to change. A module would have needed an export/import
   list threaded through ~1300 lines, which is exactly the kind of full-block
   rewrite that hides silent edits.

   Two rules follow from that and are load-bearing:
     1. Nothing may reference a chunk's symbols until its promise resolves.
        The only references are the call sites in renderFlameSheetBody().
     2. A chunk must never execute twice — its top-level `const`s would
        throw on redeclaration. Hence the cache. It is cleared only on
        `onerror`, which fires when the script never ran at all, so a retry
        after a dropped connection is safe and a retry after a successful
        load is impossible. */
const CHUNKS = Object.create(null);
function loadChunk(name) {
  if (CHUNKS[name]) return CHUNKS[name];
  CHUNKS[name] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `js/${name}.js`;
    s.onload = () => resolve();
    s.onerror = () => { delete CHUNKS[name]; reject(new Error(`${name}.js failed to load`)); };
    document.head.appendChild(s);
  });
  return CHUNKS[name];
}

/* Runs fn once the chunk is there. On a failed load it says so in the place
   the user was looking rather than doing nothing at all — a dead button is
   the worst outcome of a split like this and it is the one that would not
   show up in testing on a fast connection.
   `where` is either a text element to write the message into (the avatar
   uploader's #pfpErr) or the control that was tapped, whose label is
   flashed and put back — the same transient-label pattern toggleRoute() and
   flashSurpriseMessage() already use. It is NOT optional in practice: the
   three owner call sites passed nothing, so a failed js/owner.js made
   "List your venue", "Manage" and "Pending venues" do literally nothing on
   tap. Exactly the outcome the paragraph above was written to prevent. */
function withChunk(name, fn, where) {
  return loadChunk(name).then(fn).catch(err => {
    console.warn('[muan]', err.message);
    if (!where) return;
    const msg = "Couldn't load that — check your connection and try again.";
    if (where.tagName === 'BUTTON' || where.tagName === 'A') {
      flashLabel(where, "Couldn't load — tap to retry");
    } else {
      where.textContent = msg;
    }
  });
}

/* swaps an element's content for `msg`, then puts the original back — unless
   something else has changed it in the meantime, in which case the newer
   text wins. Generalised out of flashSurpriseMessage(), which is now one
   caller of this rather than its own copy of it.
   Detaches and re-attaches the ORIGINAL child nodes rather than saving and
   restoring textContent or innerHTML. Some of the elements this is used on
   are buttons with element children (.fl-manage-item carries its own
   chevron), and both of the shorter routes would have destroyed them: one
   drops them for good, the other rebuilds them as new nodes and quietly
   loses anything bound to the old ones. */
function flashLabel(el, msg, ms = 2500) {
  if (!el) return;
  const original = [...el.childNodes];
  el.replaceChildren(msg);
  setTimeout(() => {
    if (el.isConnected && el.textContent === msg) el.replaceChildren(...original);
  }, ms);
}

// Google Identity Services used to be a plain <script async defer> in
// index.html's <head>, so every visitor downloaded and executed it on every
// load for a button that exists in one place: the You screen, signed out.
// Injected on demand instead. openFlameSheet() starts it the moment You is
// opened, so it is usually ready by the time that screen's /api/me round
// trip finishes, and this awaits it — which also replaces the old 400ms
// polling retry with the actual load event.
let gsiPromise = null;
function loadGoogleSignIn() {
  if (window.google?.accounts?.id) return Promise.resolve(true);
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise(resolve => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve(!!window.google?.accounts?.id);
    // cleared so a later visit to the You screen retries rather than being
    // stuck on one failed load for the rest of the session
    s.onerror = () => { gsiPromise = null; resolve(false); };
    document.head.appendChild(s);
  });
  return gsiPromise;
}

async function initGoogleSignIn(containerId) {
  if (!(await loadGoogleSignIn())) {
    console.warn('[muan] Google sign-in script unavailable');
    return;
  }
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: async (resp) => {
      /* Both failure paths used to be silent: `if (data.ok)` with no else,
         and `catch (e) {}`. Google had already authenticated the person —
         their own account chooser closed successfully — and then the app
         did nothing at all, on the same screen, with the same Sign in
         button still sitting there. There is no way to read that except
         "the button is broken", and no console to check on a phone.
         The credential exchange is the one request in the app with no
         screen of its own to fail into, so the message goes where the
         person is looking: under the sign-in button. */
      const say = text => {
        const box = document.getElementById('gsi-err');
        if (box) { box.textContent = text; box.hidden = false; }
        else console.warn('[muan] sign-in:', text);
      };
      try {
        const r = await fetch('/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: resp.credential }),
        });
        const data = await r.json().catch(() => null);
        if (data?.ok) openFlameSheet();
        else say("Couldn't sign you in. Please try again.");
      } catch (e) {
        console.warn('[muan] sign-in exchange failed', e);
        say("Couldn't reach the server. Check your connection and try again.");
      }
    },
  });
  const el = document.getElementById(containerId);
  if (el) google.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with' });
}

/* The logout POST used to be `catch (e) {}` followed unconditionally by
   openFlameSheet(). When it failed, the session cookie survived, the
   re-render read /api/me, got the same signed-in user back, and drew the
   You screen exactly as it was — so pressing Sign out did visibly nothing
   and said nothing. Of all the swallowed failures in this file that is the
   one with real consequences: the whole point of the button is a person
   deciding they do not want to be signed in on this phone any more, and
   they walked away believing they were not.
   A failure now flashes the control they pressed. It cannot be a sheet-level
   message, because the sheet has just been rebuilt by openFlameSheet() —
   hence the await. */
async function signOut() {
  let ok = false;
  try {
    const r = await fetch('/api/auth/logout', { method: 'POST' });
    ok = r.ok;
  } catch (e) { console.warn('[muan] sign-out failed', e); }
  await openFlameSheet();
  if (!ok) flashLabel(document.querySelector('[data-sign-out]'), "Couldn't sign out — still signed in", 4000);
}

// Lottie-exported animated flame (assets/flame.svg) — self-contained SMIL,
// no scripts or external refs, loops at 1.083s. Fetched once and cached;
// too large (38 KB) to inline into a template string.
let flameSvgCache = null;
async function flameSvg() {
  if (!flameSvgCache) flameSvgCache = await (await fetch('assets/flame.svg')).text();
  return flameSvgCache;
}

// SMIL animations ignore prefers-reduced-motion (it's a CSS media feature;
// SMIL has no equivalent), so it has to be enforced imperatively per the
// SVGSVGElement animation API — call once right after the markup lands in
// the DOM, since pauseAnimations() only affects animations already running
function pauseFlameIfReducedMotion() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelector('.fl-flame svg')?.pauseAnimations();
  }
}

// assets/{404,Confetti,badge-unlock}.svg — same cached-fetch pattern as
// flame.svg above; none of the four ship a fixed repeatCount (all loop
// indefinitely), so anything meant to play once (see playOnceInto()) has to
// be removed on a timer rather than relying on the animation to finish
let error404SvgCache = null;
async function error404Svg() {
  if (!error404SvgCache) error404SvgCache = await (await fetch('assets/404.svg')).text();
  return error404SvgCache;
}
let confettiSvgCache = null;
async function confettiSvg() {
  if (!confettiSvgCache) confettiSvgCache = await (await fetch('assets/Confetti.svg')).text();
  return confettiSvgCache;
}
let badgeUnlockSvgCache = null;
async function badgeUnlockSvg() {
  if (!badgeUnlockSvgCache) badgeUnlockSvgCache = await (await fetch('assets/badge-unlock.svg')).text();
  return badgeUnlockSvgCache;
}

// injects svgHtml into container, pauses it under prefers-reduced-motion,
// then removes container after ms — for the confetti/badge-unlock
// celebration animations, which must play once rather than loop forever
// behind the card
function playOnceInto(container, svgHtml, ms = 3000) {
  container.innerHTML = svgHtml;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    container.querySelector('svg')?.pauseAnimations();
  }
  setTimeout(() => container.remove(), ms);
}

// injects assets/404.svg into every placeholder left by renderHomeSheet()'s
// empty states. Fetched after setSheet() has already rendered the text (not
// awaited inline), so a slow first-ever fetch never delays the sheet itself
async function injectEmptyIcons() {
  const targets = [...document.querySelectorAll('[data-empty-svg]')];
  if (!targets.length) return;
  const svgHtml = await error404Svg();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  targets.forEach(el => {
    if (!el.isConnected) return;
    el.innerHTML = svgHtml;
    if (reduced) el.querySelector('svg')?.pauseAnimations();
  });
}

async function openFlameSheet() {
  // the owner forms' back arrow, the You tab and the avatar pill all land
  // here — see edBlocksLeave() in js/owner.js (absent until that chunk loads,
  // and no owner form can be open before it has)
  if (typeof edBlocksLeave === 'function' && edBlocksLeave(openFlameSheet)) return;
  // every route into signing in lands here (the avatar pill, the You tab,
  // a 401 from check-in), so this one line is enough to have the sign-in
  // script downloading in parallel with the /api/me read below instead of
  // starting a round trip later, once initGoogleSignIn() asks for it
  loadGoogleSignIn();
  // and the same for this app's own You-screen code: js/avatar.js is 6KB and
  // is needed by every signed-in render of this screen, so start it here, in
  // parallel with the /api/me read below, rather than when
  // renderFlameSheetBody() reaches for it. See loadChunk() for the split.
  loadChunk('avatar').catch(() => {});
  toggleSheet(false);
  setSheetView({ type: 'flame', venueId: null });
  setMobileScreen('you');
  setSheet('<div class="s-sub" style="text-align:center;padding:30px 0;">Loading your flame…</div>');
  let me = null;
  try { me = await (await fetch('/api/me')).json(); } catch(e) { console.warn('[muan] /api/me failed', e); }
  if (!me || !me.ok) {
    /* "try again" with nothing to try it with was a dead end: the only way
       back was to leave the screen and come back, which is not obvious and
       is not what the sentence says. Same shape as the retry on
       fetchMyVenues()' failure further down, and it re-enters openFlameSheet()
       rather than reloading the page — Home behind this screen is fine and
       there is no reason to throw it away. */
    setSheet(`
      <div class="s-sub" style="text-align:center;padding:30px 14px;">
        Couldn't load your flame.<br>This is usually the connection.
        <button type="button" id="meRetry" class="btn btn-go" style="margin:16px auto 0;max-width:200px;">Try again</button>
      </div>`);
    document.getElementById('meRetry')?.addEventListener('click', openFlameSheet);
    return;
  }
  // this is the freshest read of avatar_url there is (the same request that
  // just fetched everything else on this screen) — keeps the top-right
  // button in sync here too, and correctly clears it back to the chibi on
  // sign-out, since me.signed_out means no avatar_url at all
  applyAvatarUrl(me.signed_out ? null : (me.avatar_url || null));

  if (me.signed_out) {
    const flameHtml = await flameSvg();
    setSheet(`
      <div class="fl-wrap">
        <div class="fl-flame" style="opacity:.4;">
          ${flameHtml}
        </div>
        <div class="fl-stage">Your flame starts here</div>
        <div class="fl-sub">Sign in to check in, keep streaks and earn embers</div>
        <div id="gsi-btn" style="display:flex;justify-content:center;margin:18px 0;"></div>
        <div id="gsi-err" class="hint" style="text-align:center;margin:-6px 0 10px;" hidden></div>
        <div class="btn-row"><button class="btn btn-back" data-home style="flex:1;">Done</button></div>
      </div>
    `);
    const sheet = document.getElementById('sheet');
    if (sheet) sheet.scrollTop = 0;
    pauseFlameIfReducedMotion();
    initGoogleSignIn('gsi-btn');
    return;
  }

  // fetched alongside the flame svg rather than inside renderFlameSheetBody
  // itself, so the flame sheet's usual single render isn't split into two
  // passes (one without the "Manage your venue" section, one with it).
  // Pending venues are only fetched for an admin — /api/pending 403s
  // everyone else anyway, no reason to make the round trip.
  const [flameHtml, myVenuesResult, pendingVenuesResult] = await Promise.all([
    flameSvg(), fetchMyVenues(), me.is_admin ? fetchPendingVenues() : Promise.resolve({ ok: true, venues: [] }),
  ]);

  if (me.show_intro) { renderFlameIntro(flameHtml, () => renderFlameSheetBody(me, flameHtml, myVenuesResult, pendingVenuesResult)); return; }

  renderFlameSheetBody(me, flameHtml, myVenuesResult, pendingVenuesResult);
}

// venues the signed-in user owns (see migrations/006_owners.sql), for the
// "Manage your venue" entry point on the flame sheet. Returns one of two
// shapes, never a bare array — { ok:true, venues } or { ok:false, venues:[] }
// — so a failed request and a legitimately-empty list stay distinguishable
// to the caller. Collapsing both into "just return []" is exactly what let
// the migration-010 outage go unnoticed: /api/my-venues 500'd for every
// owner, this used to swallow that into [], and the flame sheet rendered
// as if nobody owned anything — no error, no retry, nothing to see it by.
async function fetchMyVenues() {
  try {
    const data = await (await fetch('/api/my-venues')).json();
    return data.ok ? { ok: true, venues: data.venues } : { ok: false, venues: [] };
  } catch (e) {
    return { ok: false, venues: [] };
  }
}

// admin-only "Pending venues (N)" entry on the flame sheet — see
// functions/api/pending.js. Same three-state reasoning as fetchMyVenues()
// above: an admin seeing "(0)" needs to be able to tell "nothing pending"
// from "the request failed," or a broken endpoint just looks like a quiet day.
async function fetchPendingVenues() {
  try {
    const data = await (await fetch('/api/pending')).json();
    return data.ok ? { ok: true, venues: data.venues } : { ok: false, venues: [] };
  } catch (e) {
    return { ok: false, venues: [] };
  }
}

// first sign-in only (server flag users.intro_seen, surfaced as
// me.show_intro from /api/me — see PROBLEM in the task this was added for:
// a new user otherwise lands straight on an unexplained empty calendar and
// zero flame). One card: the flame animates cold -> burning over ~1.2s
// while three lines fade in staggered 150ms apart (see .fl-intro-line in
// style.css); "Got it" marks it seen server-side — best-effort, since an
// intro that reappears once is milder than one that traps a broken request
// — then hands off into the real (still-empty) flame sheet using the same
// `me` data, no second /api/me round trip.
function renderFlameIntro(flameHtml, onDone) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setSheet(`
    <div class="fl-wrap">
      <div class="fl-flame intro-flame" data-heat="${reduced ? 'burning' : 'cold'}">
        ${flameHtml}
      </div>
      <div class="fl-intro-title">Your flame</div>
      <div class="fl-intro-lines">
        <div class="fl-intro-line">Check in where you go out — bars, cafés, anywhere on the map.</div>
        <div class="fl-intro-line">Every check-in feeds it. Embers add up, and your flame grows.</div>
        <div class="fl-intro-line">Go out at least once a month and it stays lit.</div>
      </div>
      <div class="btn-row"><button class="btn cel-done" data-intro-done>Got it</button></div>
    </div>
  `);
  const sheet = document.getElementById('sheet');
  if (sheet) sheet.scrollTop = 0;
  pauseFlameIfReducedMotion();
  if (!reduced) {
    const flameEl = document.querySelector('.intro-flame');
    requestAnimationFrame(() => flameEl?.setAttribute('data-heat', 'burning'));
  }
  document.querySelector('[data-intro-done]')?.addEventListener('click', async () => {
    try { await fetch('/api/intro-seen', { method: 'POST' }); } catch (e) {}
    onDone();
  });
}

// how many check-ins it takes before the You screen stops inviting and
// starts reporting. Below this, the flame card is an invitation (what a
// check-in does, plus a way to the map) and the stats line is absent
// entirely: a screen that opens with "1 place · 1 check-in" and "your flame
// has cooled" is a scoreboard reading zero, which is the worst thing to
// hand someone who hasn't been given a reason to check in yet.
const FLAME_INVITE_BELOW = 3;

// the invitation that replaces the flame card below FLAME_INVITE_BELOW.
// The flame is still here — small, unlit, dimmed — because it's what the
// rest of the screen is about; what it is NOT allowed to do is carry a heat
// line. "your flame has cooled" is a sentence about a habit that lapsed,
// and nobody with two check-ins has a habit to lapse yet.
function flameInviteHtml(flameHtml, totalCheckins) {
  const first = totalCheckins === 0;
  const left = FLAME_INVITE_BELOW - totalCheckins;
  return `
    <div class="fl-card fl-card-flame fl-card-invite">
      <div class="fl-flame fl-flame-invite" data-heat="cold">
        ${flameHtml}
      </div>
      <div class="fl-invite-title">${first ? 'Light your first flame' : 'Keep it going'}</div>
      <div class="fl-invite-lines">
        <div class="fl-invite-line">Check in when you get somewhere — a bar, a caf&eacute;, anywhere on the map.</div>
        <div class="fl-invite-line">${first
          ? 'Your first check-in lights the flame and starts collecting embers.'
          : `${plural(left, 'more check-in', 'more check-ins')} and it burns on its own.`}</div>
      </div>
      <button class="btn fl-invite-btn" data-go-map>Open the map</button>
    </div>`;
}

// the normal flame card: heat, stage, embers, and one line of rhythm. Only
// reached at FLAME_INVITE_BELOW check-ins or more, so every string in here
// is safe to say about someone who actually goes out.
//
// The rhythm line replaces the old 30-dot month strip. Thirty identical
// dots with one ring on today said nothing a glance could read — no day
// numbers, no week markers, no scale — so it was decoration; the same data
// as a sentence ("3 nights out in September") is the thing the dots were
// standing in for.
function flameCardHtml(me, flameHtml, stageLabels, stageLo, heatLines, monthName) {
  const nights = me.checkin_days.length;
  return `
    <div class="fl-card fl-card-flame">
      <div class="fl-flame" data-heat="${me.heat_level}">
        ${flameHtml}
        <div class="fl-streak">${me.streak_months}</div>
      </div>
      <div class="fl-stage">${stageLabels[me.phai_stage]} · <span class="lao">${stageLo[me.phai_stage]}</span></div>
      <div class="fl-sub">${esc(heatLines[me.heat_level] || '')}</div>
      ${me.embers_total > 0 ? `<div class="fl-embers"><b>${me.embers_total}</b> embers</div>` : ''}
      <div class="fl-rhythm">${nights
        ? `<b>${nights}</b> ${nights === 1 ? 'night' : 'nights'} out in ${monthName}`
        : `no nights out yet in ${monthName}`}</div>
    </div>`;
}

// the identity card — ONE avatar, not two. The chibi IS the avatar until a
// photo is set, at which point the photo takes the same slot; the two used
// to be stacked in this card (a "+" placeholder above, the chibi below),
// which read as two unrelated pictures of the same person and left no way
// to tell which one other people would see.
//
// Under it, both "what you've collected" rows: earned badges first, then
// the item slots (locked ones included, with what unlocks them). Badges lead
// because they are the scarce half and the half that was invisible — they
// used to be a third card below a 290px flame card, off the bottom of every
// phone. Measured on a 400x860 viewport: badges now sit ~180px clear of the
// bottom nav, where they were ~70px under it.
function identityCardHtml(me, avatarIndex, items) {
  const earnedIds = items.filter(it => it.earned).map(it => it.id);
  const chibi = avatarIndex !== null ? avatarSVG(+avatarIndex, 96, earnedIds) : '😊';
  return `
    <div class="fl-card fl-card-id">
      <button type="button" class="fl-avatar" id="pfpBtn"
        aria-label="${me.avatar_url ? 'Change your photo' : 'Add a photo'}">
        ${me.avatar_url
          ? `<img class="fl-avatar-photo" src="${esc(cloudinaryAvatarUrl(me.avatar_url, 192))}" alt="">`
          : chibi}
      </button>
      ${me.handle ? `<div class="fl-handle">@${esc(me.handle)}</div>` : ''}
      ${me.total_checkins > 0
        ? `<div class="fl-id-summary">${plural(me.venues_explored, 'place', 'places')} · ${plural(me.total_checkins, 'check-in', 'check-ins')}</div>`
        : ''}
      <input type="file" id="pfpFile" accept="image/*" hidden>
      <div class="fl-pfp-err" id="pfpErr"></div>
      <div class="fl-avatar-actions">
        <button class="fl-avatar-link" id="pfpLink">${me.avatar_url ? 'Change photo' : 'Add a photo'}</button>
        ${me.avatar_url
          ? `<button class="fl-avatar-link" data-remove-pfp>Remove photo</button>`
          : `<button class="fl-avatar-link" data-open-avatar>Change avatar</button>`}
      </div>

      ${me.badges?.length ? `
      <div class="fl-collect-h">Badges</div>
      <div class="fl-badges">
        ${me.badges.map(b => `<div class="fl-badge" title="${esc(b.description||'')}">
           <span class="fl-badge-ico">${badgeIcon(b, 20)}</span>
           <span class="fl-badge-name">${esc(b.name)}</span>
         </div>`).join('')}
      </div>` : ''}

      <div class="fl-collect-h">Avatar items</div>
      <div class="fl-items-row">
        ${items.map(it => `<div class="fl-item ${it.earned ? '' : 'locked'}">
            <span class="fl-item-ico">${itemIconSVG(it.id, 18)}</span>
            <span class="fl-item-name">${esc(it.name)}</span>
            <span class="fl-item-req">${it.earned
              ? 'earned'
              : `visit ${it.need} ${esc(it.where)}${it.have ? ` · ${it.have}/${it.need}` : ''}`}</span>
          </div>`).join('')}
      </div>
    </div>`;
}

// the normal You screen — the flame (or an invitation in its place), the
// identity card, then the plain owner/admin rows. Split out of
// openFlameSheet() so renderFlameIntro()'s "Got it" can hand off into it
// directly.
function renderFlameSheetBody(me, flameHtml, myVenuesResult = { ok: true, venues: [] }, pendingVenuesResult = { ok: true, venues: [] }) {
  const stageLabels = { ember:'Ember', flicker:'Flicker', flame:'Flame', blaze:'Blaze', naga:'Naga fire' };
  const stageLo = { ember:'ຖ່ານໄຟ', flicker:'ໄຟວິບວັບ', flame:'ແປວໄຟ', blaze:'ໄຟລຸກ', naga:'ໄຟນາກ' };
  const heatLines = {
    cold: 'your flame has cooled — a night out relights it',
    glowing: 'still glowing',
    warm: 'burning steady',
    burning: 'burning bright',
    roaring: 'roaring 🔥'
  };

  const monthName = new Date().toLocaleString('en',{month:'long'});
  const avatarIndex = localStorage.getItem('muan-avatar');
  const items = itemProgress(me.venue_counts || {});
  // the one branch the whole screen turns on — see FLAME_INVITE_BELOW
  const inviting = me.total_checkins < FLAME_INVITE_BELOW;

  setSheet(`
    <div class="fl-wrap">

      ${inviting
        ? flameInviteHtml(flameHtml, me.total_checkins)
        : flameCardHtml(me, flameHtml, stageLabels, stageLo, heatLines, monthName)}

      ${identityCardHtml(me, avatarIndex, items)}

      <div class="fl-links">
        ${!myVenuesResult.ok ? `
        <div class="fl-fetch-error">
          Couldn't load your venues.
          <button type="button" class="fl-retry" data-retry-flame>Try again</button>
        </div>` : myVenuesResult.venues.length ? `
        <div class="fl-manage">
          <div class="fl-manage-h">Manage your venue</div>
          ${myVenuesResult.venues.map(v => `<button class="fl-manage-item" data-manage-venue="${v.id}">
              <span>${esc(v.short_name || v.name)}${v.pin_status === 'pending' ? '<span class="fl-manage-pending"> · pending</span>' : ''}${v.pin_status === 'rejected' ? '<span class="fl-manage-rejected"> · rejected</span>' : ''}</span><span class="fl-manage-arrow">›</span>
            </button>`).join('')}
        </div>` : ''}

        <button class="fl-avatar-link" data-list-venue>+ List your venue</button>

        ${me.is_admin ? (pendingVenuesResult.ok
          ? `<button class="fl-avatar-link" data-admin-pending>Pending venues (${pendingVenuesResult.venues.length})</button>`
          : `<button class="fl-avatar-link" data-retry-flame>Pending venues — couldn't load, tap to retry</button>`
        ) : ''}
      </div>

      <div class="btn-row"><button class="btn btn-back" data-home style="flex:1;">Done</button></div>
      <button class="fl-signout" data-sign-out>Sign out</button>
    </div>
  `);
  const sheet = document.getElementById('sheet');
  if (sheet) sheet.scrollTop = 0;
  pauseFlameIfReducedMotion();
  document.querySelector('[data-go-map]')?.addEventListener('click', goToMap);
  document.querySelector('[data-sign-out]')?.addEventListener('click', signOut);

  /* The avatar picker and the profile-photo upload are js/avatar.js now, so
     their handlers cannot be attached until it has loaded. openFlameSheet()
     kicked that load off at the same moment it started the /api/me round
     trip this screen is rendered from (same trick as loadGoogleSignIn()), so
     by here it is normally already resolved and this .then() runs in the
     same task — but it is a promise either way, so the screen paints first
     and these three controls go live a moment later rather than the whole
     screen waiting on 6KB. */
  const pfpErr = document.getElementById('pfpErr');
  withChunk('avatar', () => {
    document.querySelector('[data-open-avatar]')?.addEventListener('click', openAvatarSheet);
    document.querySelector('[data-remove-pfp]')?.addEventListener('click', removeAvatarPhoto);
    wirePfpUpload();
  }, pfpErr);

  /* js/owner.js is the big one (53KB) and most people who open You are not
     owners, so it is NOT fetched just because this screen rendered. It is
     fetched on the tap, and prefetched only for the people who have a button
     that needs it — an owner with venues, or an admin with a pending queue.
     For them it is warm by the time they reach it; for everyone else it is
     never downloaded at all. */
  const listBtn = document.querySelector('[data-list-venue]');
  const manageBtns = document.querySelectorAll('[data-manage-venue]');
  const adminBtn = document.querySelector('[data-admin-pending]');
  if (manageBtns.length || adminBtn) loadChunk('owner').catch(() => {});

  // the third argument is the button itself: js/owner.js is the one chunk
  // fetched on the tap rather than prefetched, so it is also the one whose
  // failure a person is actually standing in front of waiting for
  listBtn?.addEventListener('click', () => withChunk('owner', () => openVenueSubmitForm(), listBtn));
  manageBtns.forEach(el => el.addEventListener('click', () => {
    const v = myVenuesResult.venues.find(mv => mv.id === el.dataset.manageVenue);
    if (v) withChunk('owner', () => openVenueEditor(v), el);
  }));
  adminBtn?.addEventListener('click', () => withChunk('owner', () => openAdminPendingSheet(pendingVenuesResult.venues), adminBtn));
  // both the "couldn't load your venues" and "pending venues couldn't load"
  // states retry the same way: re-run the whole fetch+render cycle, since
  // both come from the same Promise.all in openFlameSheet()
  document.querySelectorAll('[data-retry-flame]').forEach(el => el.addEventListener('click', openFlameSheet));
}

/* The venue owner dashboard, the admin pending queue and the photo
   uploader that used to sit here are now js/owner.js — see loadChunk()
   further up for why and for the rules that keep the split safe. */

function bindTheme() {
  document.getElementById('themeBtn').addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    const cur = localStorage.getItem('muan-theme') || 'auto';
    localStorage.setItem('muan-theme', order[(order.indexOf(cur) + 1) % 3]);
    applyTheme();
  });
  setInterval(applyTheme, 60000);
}

/* ---------- map ---------- */
// MAPLIBRE HAZARD (mobile three-screen shell): #map is created once, here,
// and its container is NEVER display:none'd or resized while off-screen —
// on Home/You/any pushed-over detail view, #sheet simply sits above it in
// z-order at the same full #app size #map already has on every screen, so
// #map's own dimensions never change and there's nothing to go blank. The
// state.map.resize() call on the Map nav tap (see boot()) is a defensive
// measure for real viewport drift while covered (mobile browser chrome
// collapsing, safe-area changes) rather than a fix for a hide/show resize —
// there is no hide/show of #map itself in this design.
function initMap() {
  state.map = new maplibregl.Map({
    container: 'map',
    center: [VIENTIANE.lng, VIENTIANE.lat],
    zoom: 14,
    minZoom: MAP_BOUNDS.minZoom,
    maxBounds: MAP_BOUNDS.maxBounds,
    attributionControl: { compact: true },
    style: mapStyle(state.theme),
  });
  state.map.on('style.load', () => {
    if (state.theme === 'light' && state.map.getLayer('water')) {
      state.map.setPaintProperty('water', 'fill-color', '#CBD9DC');
    }
    if (state.theme === 'light') {
      // Positron's own road colours are already near-white (#fdfdfd fills,
      // #ddd/#e6e6e6 casings) — the milky canvas filter was pushing them
      // the rest of the way into the cream background. Recolour at the
      // source instead of relying on the filter to leave them visible.
      const roadLayers = state.map.getStyle().layers.filter(l =>
        l.type === 'line' && /road|street|highway|motorway|trunk|primary|secondary|tertiary|minor|service|path/i.test(l.id));
      roadLayers.forEach(l => {
        try {
          state.map.setPaintProperty(l.id, 'line-color', '#C9BCA4');
          // nudge minor/service/path roads a touch wider so the recolour
          // actually reads at low zoom instead of staying a hairline
          if (/minor|service|path|residential/i.test(l.id)) {
            state.map.setPaintProperty(l.id, 'line-width', [
              'interpolate', ['linear'], ['zoom'],
              12, 0.6,
              14, 1.1,
              16, 2.2
            ]);
          }
        } catch (e) { console.warn('[muan] road layer', l.id, e.message); }
      });
      // road_minor_fill/road_service_fill/road_path only start at minzoom
      // 15 while their _case casing starts at 13 — between 13 and 15 minor
      // roads are casing-only and visibly "pop in" solid at 15. Bring the
      // fill's minzoom down to meet the casing's (13.5, not 13 — the casing
      // itself doesn't exist below 13, and 13 is still an arterials-only
      // zoom by design) so the character doesn't change mid-zoom.
      const LOWER = ['road_minor_fill', 'road_service_fill', 'road_path'];
      LOWER.forEach(id => {
        if (!state.map.getLayer(id)) return;
        const l = state.map.getLayer(id);
        state.map.setLayerZoomRange(id, 13.5, l.maxzoom ?? 24);
      });
    }
    /* NOT theme-scoped, unlike the two blocks above. Those are colour fixes
       for Positron's near-white palette and Dark Matter needs neither. This
       one is about how much text sits under our own markers, which is the
       same question in both themes — and it became load-bearing on night the
       moment night stopped being a raster basemap (see DARK_STYLE_URL).
       Positron and Dark Matter are the same style with different paint:
       93 layers each, 27 symbol layers each, identical ids, and the same
       seven matched here (place_hamlet, place_suburbs, place_villages,
       poi_stadium, poi_park, roadname_minor, housenumber). Left light-only,
       the switch to vector would have handed the night map seven label
       layers the raster tiles never showed — fixing the watermark and
       regressing the legibility in the same change. */
    {
      const symbolLayers = state.map.getStyle().layers.filter(l => l.type === 'symbol');
      const NOISY = ['place_hamlet','place_village','place_suburb','place_suburbs',
                     'poi','poi_r','housenumber','roadname_minor'];
      symbolLayers.forEach(l => {
        if (NOISY.some(n => l.id.startsWith(n))) {
          state.map.setLayoutProperty(l.id, 'visibility', 'none');
        }
      });
    }
    // setStyle() (theme change) wipes any runtime-added source/layers —
    // redraw the route (with the correct casing colour for the new theme)
    // if one was showing when the style swapped
    if (state.currentRouteGeometry) drawRouteLayers(state.currentRouteGeometry);
  });
  // markers are DOM elements MapLibre positions over the map — they don't
  // need tiles to have loaded, so they must not be stuck waiting solely on
  // 'load' (which may never fire on a CDN outage/blocked domain/ad-blocker).
  // renderMarkersOnce() guards against running twice if 'load' does still
  // fire after the fallback timer already rendered them
  let markersDone = false;
  function renderMarkersOnce() {
    if (markersDone) return;
    markersDone = true;
    renderMarkers();
    updateUserMarker();   // no-op unless a fix landed while the map was still loading
  }
  state.map.on('load', () => {
    state.map.resize();
    requestAnimationFrame(() => {
      state.map.resize();
      renderMarkersOnce();
      // pending venues have no lat/lng to extend the bounds with — see
      // renderMarkers()'s comment above
      const placed = state.venues.filter(v => v.lat != null && v.lng != null);
      if (placed.length > 1) {
        const b = new maplibregl.LngLatBounds();
        placed.forEach(v => b.extend([v.lng, v.lat]));
        state.map.fitBounds(b, { padding: { top: 90, bottom: 60, left: 70, right: 70 }, maxZoom: 14.5 });
      }
    });
  });
  setTimeout(renderMarkersOnce, 8000);
  state.map.on('zoom', () => {
    document.getElementById('map').classList.toggle('labels-hidden', state.map.getZoom() < 12.2);
  });
  state.map.on('zoomend', () => scheduleLabelCrowding());
  state.map.on('moveend', () => scheduleLabelCrowding());
  state.map.on('click', (e) => {
    if (e.originalEvent.target.closest('.marker')) return;
    if (state.selectedId) { stopTracking(); goHome(); }
    if (window.innerWidth < 768) toggleSheet(true);
  });
}

// below this zoom, markers simplify to dots (see pinSVG(), updateLabelCrowding())
const DOT_ZOOM_THRESHOLD = 14;

/* both the teardrop pin and the low-zoom dot are always drawn into the SAME
   fixed-size svg (width/height never change between them — only these two
   <g> layers' opacity crossfades, driven by .marker.zoom-dot/.selected in
   style.css) so .marker's own box can never change size or shift position.
   See updateLabelCrowding() for what toggles .zoom-dot. */
/* map labels are one nowrap line centred under the pin, so a long name has
   nowhere to go but sideways: a 60-character name with no short_name drew a
   327px label, 95px past the right edge of a 390px screen, over every pin
   beside it. Cut in JS rather than with CSS overflow — a clip box would also
   clip .m-label's text-shadow halo and the day theme's 1px outline. The
   full name is on the venue sheet one tap away. 22 is the longest
   short_name in data/venues.json ("KOKKOK Mega Mall", 16) plus room. */
const MARKER_LABEL_MAX = 22;
function markerLabel(v) {
  const s = v.short_name || v.name || '';
  return s.length > MARKER_LABEL_MAX ? s.slice(0, MARKER_LABEL_MAX - 1).trimEnd() + '…' : s;
}

function pinSVG(color, scale, variant) {
  const s = 30 * scale;
  const badge = variant === 'event'
    ? `<circle class="pin-dot" cx="62" cy="15" r="5" fill="var(--flame)" stroke="var(--ink)" stroke-width="2">
      <animate attributeName="r" values="5;6.2;5" dur="2.4s" repeatCount="indefinite"/>
    </circle>`
    : variant === 'pick'
    ? `<circle class="pin-dot" cx="62" cy="15" r="5" fill="var(--gold)" stroke="var(--ink)" stroke-width="2"/>`
    : '';

  // dot is centred on (36, 80) — as close as possible to the pin's own tip
  // (36, 84) without the pick ring's outer edge clipping against the
  // viewBox's bottom edge (0 0 72 88); at rendered size that's a ~2px
  // difference, imperceptible under the 150ms opacity crossfade, and every
  // variant shares the same coordinate so the ring stays concentric with the dot
  const dotFill = variant === 'event' ? 'var(--flame)' : color;
  const dotClass = variant === 'event' ? 'dot-mark dot-event' : 'dot-mark';
  const dotPickRing = variant === 'pick'
    ? `<circle cx="36" cy="80" r="7" fill="none" stroke="var(--gold)" stroke-width="1.5"/>`
    : '';

  return `<svg width="${s}" height="${s * 1.2}" viewBox="0 0 72 88">
    <g class="pin-layer">
      <path d="M36 4 C18 4 6 17 6 33 C6 52 26 70 36 84 C46 70 66 52 66 33 C66 17 54 4 36 4 Z" fill="${color}"/>
      <circle cx="36" cy="32" r="13" fill="#131019"/>
      ${badge}
    </g>
    <g class="dot-layer">
      ${dotPickRing}
      <circle class="${dotClass}" cx="36" cy="80" r="5" fill="${dotFill}" stroke="var(--ink)" stroke-width="2"/>
    </g>
  </svg>`;
}

/* the negative-space flame's fill must match whatever surface the mark sits
   on (splash background, pill background, etc.) — never hardcode it */
function logoMark(size, negativeFill) {
  return `<svg width="${size}" height="${Math.round(size*88/72)}" viewBox="0 0 72 88" aria-hidden="true">
    <path d="M36 4 C18 4 6 17 6 33 C6 52 26 70 36 84 C46 70 66 52 66 33 C66 17 54 4 36 4 Z" fill="var(--flame)"/>
    <path d="M36 22 C31 32 23 37 23 48 C23 57 29 63 36 63 C43 63 49 57 49 48 C49 41 44 37 41 31 C40 36 37 37 36 36 C38 31 38 26 36 22 Z" fill="${negativeFill}"/>
  </svg>`;
}

function icoLocate(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="8.5"/>
    <path d="M12 1v3M12 20v3M1 12h3M20 12h3"/></svg>`;
}
function icoSun(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4.5"/>
    <path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>`;
}
function icoMoon(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z"/></svg>`;
}
// weather widget glyphs (weatherWidgetHtml() below) — same stroke-icon style
// as icoSun/icoMoon above, not emoji. Five categories only (see
// weatherCategory()): clear reuses icoSun/icoMoon picked by is_day, these
// four cover partly-cloudy/cloudy/rain/thunder.
function icoPartlyCloudy(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="8" cy="8" r="3"/>
    <path d="M8 2.5v1.4M13 5.5l-1 1M3 5.5l1 1" stroke-linecap="round"/>
    <path d="M9 19h9a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 8.6 10.2 3.5 3.5 0 0 0 9 19Z"/></svg>`;
}
function icoCloud(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9.1 4 4 0 0 0 7 18Z"/></svg>`;
}
function icoRain(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M7 14h9a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 5.1 4 4 0 0 0 7 14Z"/>
    <path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/></svg>`;
}
function icoThunder(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M7 13h9a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 4.1 4 4 0 0 0 7 13Z"/>
    <path d="M13 13l-3 5h3l-2 4"/></svg>`;
}
// WMO weather_code (https://open-meteo.com/en/docs, "WMO Weather interpretation
// codes") collapsed to the five glyphs above — a code-per-glyph table isn't
// worth it here, this is decoration for a 96px card, not a forecast app.
// Snow codes fall into 'rain' too: Vientiane's forecast is never going to
// return one, and if Open-Meteo's model ever did something is more wrong
// than which icon shows.
function weatherCategory(code) {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly-cloudy';
  if (code === 3 || code === 45 || code === 48) return 'cloudy';
  if (code === 95 || code === 96 || code === 99) return 'thunder';
  return 'rain';
}
function weatherIconHtml(cat, isDay, size) {
  if (cat === 'clear') return isDay ? icoSun(size) : icoMoon(size);
  if (cat === 'partly-cloudy') return icoPartlyCloudy(size);
  if (cat === 'cloudy') return icoCloud(size);
  if (cat === 'thunder') return icoThunder(size);
  return icoRain(size);
}
// The dry widget's condition word is Lao now, not English — the whole
// header above it is Lao-first (see the `sub` const in renderHomeSheet()),
// and "clear" was the one English word wedged into that block. Only the
// three dry categories are here: rain and thunder never reach this map,
// they go down weatherWidgetHtml()'s rain branch, which has its own
// already-reviewed Lao (ຝົນຕົກຢູ່ / ຝົນອາດຕົກ).
//
// TODO(lao): every string in this map needs a native-speaker check before
// it can be treated as verified — they are first-pass words, not confirmed
// copy. Each carries the English it is meant to say, so a wrong one is
// corrected here in one line rather than by rebuilding the widget. This
// replaced a WEATHER_LABELS map of exactly those English words, which had
// no other caller once the widget went Lao and so went with it.
const WEATHER_LABELS_LO = {
  clear: 'ແຈ້ງ',                    // TODO(lao): check — intended "clear/bright"
  'partly-cloudy': 'ມີເມກບາງສ່ວນ',  // TODO(lao): check — intended "partly cloudy"
  cloudy: 'ມີເມກ',                  // TODO(lao): check — intended "cloudy/overcast"
};

// at or above this, the temperature is the story and the sky is not
const HOT_C = 33;

// the second line of the dry widget: what the weather means for going out.
// "26° clear" is a fact nobody acts on; this is the sentence that fact was
// standing in for, which is the only reason the widget is worth a glance.
//
// Order matters. Heat outranks the sky — 34° under a clear sky is not "fine
// for sitting outside", it is too hot to walk far, and that is true whether
// the sun is out or behind cloud. Below HOT_C, only a genuinely clear sky
// gets the encouraging line, split day/night because a rooftop after dark
// and a pavement table at noon are different invitations.
//
// 'partly-cloudy' deliberately reads as cloudy, not clear: WMO folds both
// "mainly clear" and "partly cloudy" into it (see weatherCategory()), so
// half of what lands here genuinely is cloud, and "mild out" is never wrong
// for either — while "fine for sitting outside" under thickening cloud is.
// One line to move it if that turns out too cautious in practice.
//
// No lower temperature bound: Vientiane's cool season still sits well above
// anywhere "fine for sitting outside" stops being true, and inventing a
// cold threshold would mean inventing the copy that goes with it.
function weatherReadHtml(cat, tempC, isDay) {
  if (tempC >= HOT_C) return 'too hot to walk far';
  // "looks": the sky here is Open-Meteo's grid model, not an observation —
  // see the note on rainPartOfDay() below for why that matters in Vientiane.
  if (cat === 'clear') return isDay ? 'looks fine for sitting out' : 'looks like a rooftop night';
  return 'mild out';
}
// "8pm", not "20:00" or "8:00pm" — matches the one-line, glance-length copy
// the card is built for
const formatHour12 = h => `${h % 12 === 0 ? 12 : h % 12}${h >= 12 ? 'pm' : 'am'}`;
// the rain line names a stretch of the day, not an hour (see
// weatherWidgetHtml()). The forecast window is six hours, so a start hour
// can be past midnight: an hour earlier in the clock than now, but 5am or
// later, is tomorrow morning, and "this morning" at 11pm would be wrong.
function rainPartOfDay(h, nowH = new Date().getHours()) {
  if (h < nowH && h >= 5) return 'early tomorrow';
  if (h >= 5 && h < 12) return 'this morning';
  if (h >= 12 && h < 17) return 'this afternoon';
  if (h >= 17 && h < 21) return 'this evening';
  return 'tonight';
}
// state.weather is either a trimmed {ok:true, ...} body or null — boot()'s
// fetch hasn't resolved yet, or failed. Either way, rendering nothing here
// is the entire failure/absence UI: no placeholder, no error text, no
// reserved space. This is a normal in-flow element (.weather-bar in
// style.css) sitting at the right-hand end of the Home subhead's row
// (.s-subrow — see renderHomeSheet()) — when this returns '', the row is
// simply the subhead on its own, with nothing sitting there empty.
// 50% is a judgment call, not a value Open-Meteo hands back pre-labeled —
// "more likely than not", which is the point at which a forecast is worth
// changing a plan over. Must stay in step with RAIN_LIKELY in
// functions/api/weather.js, which uses the same number to pick which hour
// precip_start_hour names; see the note there for what drifting apart does.
const RAIN_LIKELY_PCT = 50;

// the one place that decides whether rain is a factor right now: 'now' if it
// is already falling, 'likely' if it probably will within the forecast
// window, null otherwise. Two callers with two very different jobs — the
// widget's own copy, and outdoorNoteHtml() deciding whether an open-air
// venue's card says anything at all — and they must never disagree, which
// they would the moment each re-derived "is it raining" from state.weather
// on its own.
//
// "already falling" comes from the CURRENT condition code, not from the
// hourly probability: if cat is 'rain' or 'thunder' that is what is
// happening, and pairing a thunder icon with "rain likely 9pm" contradicts
// itself. precip_chance is only consulted once we know it is dry now.
function rainState() {
  const w = state.weather;
  if (!w) return null;
  const cat = weatherCategory(w.code);
  if (cat === 'rain' || cat === 'thunder') return 'now';
  if (w.precip_chance >= RAIN_LIKELY_PCT) return 'likely';
  return null;
}

// the hour the rain is expected to START, not the hour it peaks.
// precip_start_hour is the field that actually answers "from when"; it was
// added to /api/weather for this sentence (see the RAIN_LIKELY note there).
// precip_peak_hour is the fallback for exactly one case and it is a real
// one: /api/weather caches for an hour, so for up to an hour after this
// ships a client can be handed a body written by the old code, with a peak
// hour and no start hour. Naming the peak is wrong-but-close; naming
// nothing is worse than either, so the peak stands in until the cache turns
// over. `?? ` and not `||` — hour 0 is midnight, not missing.
function rainFromHour() {
  const w = state.weather;
  if (!w) return null;
  return w.precip_start_hour ?? w.precip_peak_hour ?? null;
}

function weatherWidgetHtml() {
  const w = state.weather;
  if (!w) return '';
  const cat = weatherCategory(w.code);
  const rain = rainState();

  // Rain changes the widget's character, not just its text. Dry, it is one
  // quiet line beside the subhead saying a temperature nobody acts on. Wet,
  // it is the only weather fact in Vientiane that changes a plan, so it
  // takes a line of its own and wears the flame (.weather-rain in
  // style.css, which is what makes it break onto that line).
  if (rain) {
    const from = rainFromHour();
    // "from <hour>" is an onset, and the forecast window's first entry is
    // the hour we are already standing in — so a start hour equal to the
    // current hour would render "rain likely from 10pm" at 10:40pm, which
    // reads as forty minutes of warning that do not exist. Say "within the
    // hour" instead. No hour at all (a stale cached body with neither
    // field) degrades to the vaguer line rather than to no line.
    // Claims less than it used to, on purpose. Kar reports the forecast is
    // often wrong, and it will be: Open-Meteo is a global grid model, and a
    // Vientiane evening shower is convective — it can soak one ban and miss
    // the next. A grid cell cannot say "from 8pm" with the precision that
    // sentence implies, and "raining now" is the model's current cell, not
    // a rain gauge. So: a part of the day rather than an hour, "around"
    // rather than "likely"/"now". Was 'raining now' / 'rain likely from
    // 8pm' / 'rain likely within the hour' / 'rain likely later'.
    // precip_start_hour is still what picks the part of the day.
    const enNow = 'rain around now';
    const enSoon = from == null ? 'rain around later'
      : from === new Date().getHours() ? 'rain around soon'
      : `rain around ${rainPartOfDay(from)}`;
    // ຝົນຕົກຢູ່ = "rain is falling" (ຢູ່ marks it as happening now).
    // ຝົນອາດຕົກ = "rain may fall" — ອາດ is the hedge, and it is doing the
    // same job "likely" does in the English half. See the report on why
    // this is ອາດ and not ຈະ.
    // both states take the hedge now. ຝົນຕົກຢູ່ ("rain is falling") asserted
    // exactly what the English stopped asserting; ຝົນອາດຕົກ is the existing,
    // reviewed string, not new Lao. If Kar wants the two states told apart
    // in Lao again, that wording is his to write.
    const lo = 'ຝົນອາດຕົກ';
    const en = rain === 'now' ? enNow : enSoon;
    return `
      <div class="weather-bar weather-rain">
        <div class="weather-ico">${weatherIconHtml(cat, w.is_day, 20)}</div>
        <div class="weather-rain-text"><span class="lao">${lo}</span> · ${esc(en)}</div>
      </div>`;
  }

  // Dry. Was an icon, a temperature and an English condition word on one
  // line — "26° clear", which is a reading off an instrument, not a reason
  // to look. It is a small card now: a neutral disc holding the glyph, the
  // temperature and Lao condition together on top, and underneath, in the
  // quietest type on the row, what that weather means for going out (see
  // weatherReadHtml()). The disc is neutral rather than tinted because the
  // dry widget is context, not a signal — rain is the state that is allowed
  // to wear a colour, and it still does, on the branch above.
  //
  // Still inside .s-subrow with no wrapper of its own, so it keeps its place
  // beside the subhead exactly as before; .s-subrow's compacting rules in
  // style.css are what fit it there.
  return `
    <div class="weather-bar weather-dry">
      <div class="weather-disc">${weatherIconHtml(cat, w.is_day, 17)}</div>
      <div class="weather-dry-text">
        <div class="weather-dry-now">${Math.round(w.temp_c)}&deg; &middot; <span class="lao">${WEATHER_LABELS_LO[cat] || WEATHER_LABELS_LO.cloudy}</span></div>
        <div class="weather-dry-read">${esc(weatherReadHtml(cat, w.temp_c, w.is_day))}</div>
      </div>
    </div>`;
}

// the small note an open-air venue's card carries while rain is a factor.
// Every condition here is a deliberate "say nothing" rather than a default:
//
//   - v.outdoor !== true covers both false (audited, indoors) and the field
//     being absent (nobody has looked — see migrations/016_outdoor.sql,
//     which is every venue on the day this ships). Absent must not fall
//     through to a note; a venue that has never been checked would then be
//     telling people it might shut.
//   - rainState() null means dry and staying dry, and an open-air rooftop
//     on a clear evening is a reason to go, not a warning.
//
// Deliberately does NOT hide or reorder anything — the list is unchanged
// and this is one neutral line on the card, because someone reading Home in
// the rain may well be planning tomorrow.
function outdoorNoteHtml(v) {
  if (v.outdoor !== true || !rainState()) return '';
  return '<div class="t-note">open-air &middot; may close in rain</div>';
}
// Open-Meteo's terms ask for attribution wherever the data shows — same
// small dim treatment as the OpenStreetMap routing credit (#routeAttribution
// in openVenue()/showRoute()), just on Home instead of venue detail, so
// there's no single shared element to reuse across the two screens. Tied to
// the same state.weather check as the widget itself: crediting a source for
// data that isn't currently on screen would be worse than not crediting it.
const weatherAttributionHtml = () =>
  state.weather ? '<div class="hint">forecast &middot; Open-Meteo &middot; local showers can differ</div>' : '';

/* mobile bottom nav — same stroke-icon style as icoLocate/icoSun/icoMoon
   above (24x24 viewBox, stroke-width 2, currentColor) rather than emoji,
   which render inconsistently across platforms and clash with that set */
function icoHomeNav(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 10.5 12 3l9 7.5"/>
    <path d="M5.5 9v10a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9"/>
    <path d="M9.5 20v-6h5v6"/></svg>`;
}
function icoMapNav(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 21s-7-5.686-7-11a7 7 0 1 1 14 0c0 5.314-7 11-7 11z"/>
    <circle cx="12" cy="10" r="2.5"/></svg>`;
}
// deliberately a plain single-path outline. There used to be a detailed
// two-path flame (miniFlame(), a coral outer with a gold core) and this one
// existed because that one turned to mush at nav-icon size — the same
// reason it has now been dropped from the On fire header too, leaving this
// as the app's only small flame mark. The big profile flame is a separate
// thing again: assets/flame.svg, loaded by flameSvg(), and untouched.
function icoFlameNav(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 21c-4 0-7-3-7-7 0-2.8 1.6-5 3-7.2C8.3 8.2 9 10 10 10.5 9.5 7 11 4 12 2c1 2 2.5 5 2 8.5 1-.5 1.7-2.3 2-3.7C17.4 8.8 19 11 19 13.8c0 4.3-3 7.2-7 7.2Z"/></svg>`;
}

// Sleek item 37: the You tab's icon. Same 24x24 / stroke-2 family as the
// house and pin beside it — the flame (icoFlameNav above, left in place and
// one line from being reinstated) was the odd one out in that row.
function icoPersonNav(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="8" r="4"/>
    <path d="M4.5 21c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6"/></svg>`;
}

function icoSearch(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>`;
}
function icoSurprise(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="4.5" y="4.5" width="15" height="15" rx="3.5"/>
    <circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/>
    <circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" stroke="none"/></svg>`;
}

/* ---------- venue detail glyphs + row helpers ----------
   Same stroke-icon family as icoLocate/icoHomeNav above (24x24 viewBox,
   stroke-width 2, currentColor) — the venue sheet's detail group used
   emoji (📍🕐📞🅿ℹ️📘🌐) until this redesign, which is exactly the
   inconsistency the header icons were replaced for: emoji carry their own
   colour and their own per-platform weight, so a row of them reads as
   seven unrelated badges instead of one quiet list. */
function icoBack(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M15 4 7 12l8 8"/></svg>`;
}
function icoShare(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 16V4"/><path d="M8 7.5 12 3.5l4 4"/>
    <path d="M5 13v6a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6"/></svg>`;
}
function icoCheck(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M5 12.5 10 17.5 19 7"/></svg>`;
}
function icoPin(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 21s-7-5.686-7-11a7 7 0 1 1 14 0c0 5.314-7 11-7 11z"/>
    <circle cx="12" cy="10" r="2.5"/></svg>`;
}
function icoClock(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.2l3.2 2"/></svg>`;
}
function icoPhone(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M7.5 3.5h-2A2.5 2.5 0 0 0 3 6.2C3 14 10 21 17.8 21a2.5 2.5 0 0 0 2.7-2.5v-2l-4.5-1.7-2 2.2a13.6 13.6 0 0 1-5-5l2.2-2Z"/></svg>`;
}
/* a P in a rounded square rather than a lettered glyph — the parking note is
   a one-liner (see CLAUDE.md's parking field), so the icon carries the
   category on its own */
function icoParking(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3.5" y="3.5" width="17" height="17" rx="4"/>
    <path d="M9.8 17V7h3.1a2.9 2.9 0 0 1 0 5.8H9.8"/></svg>`;
}
function icoLink(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.3 1.3"/>
    <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.3-1.3"/></svg>`;
}
function icoSpoon(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M7 3v7M10 3v7M8.5 10v11"/>
    <path d="M16.5 3c-1.7 1.6-2.5 3.8-2.5 6 0 1.7 1 3 2.5 3s2.5-1.3 2.5-3c0-2.2-.8-4.4-2.5-6Z"/>
    <path d="M16.5 12v9"/></svg>`;
}
function icoCompass(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9"/>
    <path d="M15.5 8.5l-2 5-5 2 2-5 5-2Z"/></svg>`;
}
function icoChair(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M6 11V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5"/>
    <path d="M4.5 11h15"/><path d="M6.5 14.5h11"/>
    <path d="M7 14.5V20M17 14.5V20"/></svg>`;
}
function icoWaves(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M2 7.5c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0"/>
    <path d="M2 13c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0"/>
    <path d="M2 18.5c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0"/></svg>`;
}

/* Badge glyphs, keyed by badge code (the API sends it as `id` — see
   `b.code AS id` in functions/api/me.js and checkin.js). The badges table
   carries an `icon` column seeded with emoji (migrations/003_badges.sql),
   which breaks this project's never-emoji rule and renders differently on
   every Android build. Overridden here rather than by a migration on
   purpose: which glyph draws a badge is presentation, not data, so it
   belongs with the other ico* functions and needs no --remote migration
   run to ship (see CLAUDE.md's migration rules). Unknown codes fall back to
   the flame rather than to b.icon, so a badge added server-side can never
   put an emoji back on the screen. */
const BADGE_ICONS = {
  'first-fire': icoFlameNav,
  'explorer':   icoCompass,
  'regular':    icoChair,
  'riverside':  icoWaves,
  'night-owl':  icoMoon,
};
function badgeIcon(b, size) {
  return (BADGE_ICONS[b.id] || icoFlameNav)(size);
}

/* one card of the venue sheet's factual detail group — icon in a 40px
   tinted disc, everything else in the flow column beside it. A helper
   rather than repeated markup so a row can never drift into having its own
   divider or its own icon size again. */
function vdRow(icon, main) {
  return `<div class="vd-row"><span class="vd-row-ico" aria-hidden="true">${icon}</span><div class="vd-row-main">${main}</div></div>`;
}

/* splits a description into [first sentence, everything after it] for the
   venue sheet's "More" link. Returns ['', ''] for empty text and
   [wholeThing, ''] when there's only one sentence, so the caller can skip
   the link entirely rather than showing a "More" that reveals nothing.
   The lookahead on whitespace-or-end is what keeps "10 a.m." and "No.1"
   from being read as a sentence end mid-line — a full stop only counts
   when something actually follows it as a break. */
function firstSentence(text) {
  const t = (text || '').trim();
  if (!t) return ['', ''];
  const m = /^[\s\S]*?[.!?](?=\s|$)/.exec(t);
  if (!m) return [t, ''];
  return [m[0], t.slice(m[0].length).trim()];
}

function renderMarkers() {
  // maplibre-gl.js loads async now, so a filter tap (bindChips) can land
  // before there is a map to hang markers on — initMap()'s own
  // renderMarkersOnce() draws them as soon as there is
  if (!state.map) return;
  state.markers.forEach(m => m.marker.remove());
  state.markers = [];

  // pending venues (migrations/009_pin_status.sql) have no confirmed
  // lat/lng — no marker at all until Kar places the pin, not a marker at
  // some placeholder location
  const visible = state.venues.filter(v =>
    v.pin_status !== 'pending' && v.lat != null && v.lng != null &&
    (state.filter === 'all' ||
    v.type === state.filter ||
    (state.filter === 'event' && venueEvents(v.id).length > 0))
  );

  for (const v of visible) {
    const hot = isNo1(v);
    const el = document.createElement('div');
    el.className = 'marker type-' + v.type;

    const today = todayISO();
    const hasEventToday = state.events.some(ev => ev.venue_id === v.id && eventDate(ev) === today);
    const isPick = (state.picks?.venue_ids || []).includes(v.id)
                   && Array.isArray(v.photos) && v.photos.length > 0;
    el.classList.toggle('pin-event', hasEventToday);
    el.classList.toggle('pin-pick', isPick && !hasEventToday);
    const variant = hasEventToday ? 'event' : (isPick ? 'pick' : null);
    el.innerHTML = `
      ${pinSVG(hot ? 'var(--flame)' : COLORS[v.type] || 'var(--mute)', hot ? 1.25 : 1, variant)}
      <div class="m-label">${esc(markerLabel(v))}</div>
      ${hot ? `<div class="m-sub" style="color:var(--flame)">tonight</div>` : ''}`;
    el.addEventListener('click', () => openVenue(v.id));

    /* visual de-overlap only — real coords stay in data and directions */
    const seen = state.markers.filter(m => {
      const p = m.marker.getLngLat();
      return Math.abs(p.lat - v.lat) < 0.0004 && Math.abs(p.lng - v.lng) < 0.0004;
    }).length;
    const offLng = v.lng + seen * 0.00055;

    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([offLng, v.lat])
      .addTo(state.map);
    state.markers.push({ id: v.id, venue: v, hasEventToday, isPick, el, marker });
  }
  updateLabelCrowding();
  updateSelection();
}

/* priority order for keeping a label when pins crowd together, highest first */
function labelPriorityRank(m) {
  if (m.hasEventToday) return 0;
  if (m.isPick) return 1;
  if (openStatus(m.venue).open) return 2;
  if (Array.isArray(m.venue.photos) && m.venue.photos.length > 0) return 3;
  return 4;
}

function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/* walks markers highest-priority first, keeping a label unless its rect
   collides with an already-kept label's rect. re-run (debounced, see
   scheduleLabelCrowding) on zoomend/moveend since screen-space rects shift
   as the map view changes — this is now the only thing governing label
   visibility mid-crowd, replacing the old fixed zoom-threshold classes.
   Also carries the pin/dot zoom-threshold pass (see DOT_ZOOM_THRESHOLD,
   pinSVG()) since it needs to recompute on the same zoomend/moveend events,
   debounced the same way. */
function updateLabelCrowding() {
  const isDot = state.map.getZoom() < DOT_ZOOM_THRESHOLD;
  state.markers.forEach(m => m.el.classList.toggle('zoom-dot', isDot));

  state.markers.forEach(m => m.el.classList.remove('label-crowded'));

  const sorted = [...state.markers].sort((a, b) => {
    const r = labelPriorityRank(a) - labelPriorityRank(b);
    return r !== 0 ? r : a.venue.name.localeCompare(b.venue.name);
  });

  const kept = [];
  for (const m of sorted) {
    const label = m.el.querySelector('.m-label');
    if (!label) continue;
    const rect = label.getBoundingClientRect();
    const collides = kept.some(k => rectsOverlap(rect, k));
    if (collides) m.el.classList.add('label-crowded');
    else kept.push(rect);
  }
}

/* debounced so a continuous pinch/scroll doesn't recompute every frame */
let labelCrowdingTimer = null;
function scheduleLabelCrowding() {
  clearTimeout(labelCrowdingTimer);
  labelCrowdingTimer = setTimeout(updateLabelCrowding, 120);
}

function updateSelection() {
  const mapEl = document.getElementById('map');
  mapEl.classList.remove('map-has-selection');
  if (state.selectedId) mapEl.classList.add('map-has-selection');

  document.querySelectorAll('.marker.selected')
    .forEach(el => el.classList.remove('selected'));
  const sel = state.markers.find(m => m.id === state.selectedId);
  if (sel) sel.el.classList.add('selected');
  updateSelectedDistancePill();
}

/* how far away the selected pin is, on the pin. Distance is the fact that
   decides whether a place is worth the trip, and it only showed up after
   the sheet was already open — by which point the map has stopped being
   what you're looking at.
   Deliberately only the selected marker: every pin wearing a number is a
   different screen (a data layer, not a map), and it's the one place where
   the extra element can't multiply. Deliberately only with a real fix —
   distanceTo() returns null with no state.userPos or no venue coords
   (pending venues have neither, see pin_status in CLAUDE.md), and no pill
   is right where a guessed one would be wrong.
   Called from updateSelection() for the selection changing, and from
   requestLocation()/refineLocation() for the position changing underneath
   a selection that hasn't. */
function updateSelectedDistancePill() {
  document.querySelectorAll('.marker .m-dist').forEach(el => el.remove());
  if (!state.selectedId || !state.userPos) return;
  const sel = state.markers.find(m => m.id === state.selectedId);
  if (!sel) return;
  const d = distanceTo(sel.venue);
  if (d == null) return;
  const pill = document.createElement('div');
  pill.className = 'm-dist';
  pill.textContent = fmtDist(d);
  sel.el.appendChild(pill);
}

/* phase 1 "No.1 tonight" = first venue with a verified event today.
   phase 2 replaces this with real check-in counts from the API. */
function isNo1(v) {
  const today = todayISO();
  const first = state.events.find(ev => eventDate(ev) === today);
  return first && first.venue_id === v.id;
}

/* ---------- opening hours ---------- */
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function openStatus(v) {
  // hours_note covers venues with genuinely no daily schedule (e.g. an
  // exhibition centre that only opens for events) — "hours unconfirmed"
  // would wrongly imply nobody checked
  if (!v.hours) return { open: false, label: v.hours_note || 'hours unconfirmed' };
  const now = new Date();
  const today = DAYS[now.getDay()];
  const yesterday = DAYS[(now.getDay() + 6) % 7];
  const mins = now.getHours() * 60 + now.getMinutes();

  // spillover from yesterday (e.g. "17:00-25:30" = open till 1:30 am)
  const y = parseHours(v.hours[yesterday]);
  if (y && y.close > 1440 && mins < y.close - 1440) {
    return { open: true, label: `open until ${fmtTime(y.close - 1440)}` };
  }
  const t = parseHours(v.hours[today]);
  if (!t) return { open: false, label: 'closed today' };
  if (mins < t.open) {
    // openingSoon: within the hour — see statusPillHtml()'s flame tier
    return { open: false, openingSoon: t.open - mins <= 60, label: `opens ${fmtTime(t.open)}` };
  }
  if (mins < Math.min(t.close, 1440) || t.close > 1440) {
    return { open: true, label: `open until ${fmtTime(t.close % 1440)}` };
  }
  return { open: false, label: 'closed' };
}

// small "Open"/"Opens 5 pm"/"Closed" pill for a card's photo corner — a
// single place turning openStatus()'s open/openingSoon/closed tri-state
// into the pill's tone + text so every card renderer agrees, rather than
// leaving the state to be implied by the .closed dimming alone.
// v.hours === null means the hours are genuinely unknown — no pill rather
// than guessing or printing "unknown" (see CLAUDE.md: never invent hours).
// `full` asks for the longer "Open until 9 pm" form on cards with room for
// it (photo wide enough); closed/opening-soon stay this short regardless,
// and the wording always comes straight from openStatus() — see the venue
// sheet's own hours line, which reads the same st.label.
function statusPillHtml(v, full) {
  if (!v.hours) return '';
  const st = openStatus(v);
  if (st.open) return `<span class="status-pill open">${esc(full ? cap(st.label) : 'Open')}</span>`;
  if (st.openingSoon) return `<span class="status-pill soon">${esc(cap(st.label))}</span>`;
  return `<span class="status-pill closed">Closed</span>`;
}

// wraps a card's photo <img> so statusPillHtml() can sit absolutely
// positioned over its top-left corner without the fade applied to .closed
// cards' text ever touching the photo itself (see .status-pill/.photo-wrap
// in style.css)
/* ---------- ratings: Paisaidee's own reviews, when there are any ---------- */
// rating / review_count (migrations/017_why_rating.sql) are the SHAPE for
// reviews this app does not have yet. The rule that matters is the empty
// case: return '' — no line, no "No reviews yet", nothing — unless
// review_count is a whole number above zero AND rating is a real number.
// Thirty cards each saying there is nothing to say is worse than thirty
// clean cards. Never fed from Google or any aggregator (see the migration).
// The star is not --gold: CLAUDE.md keeps gold for rewards and badges, and
// a rating is neither — it takes the line's own quiet colour.
function ratingLineHtml(v, cls = 'v-rating') {
  const n = v.review_count, r = v.rating;
  if (!Number.isInteger(n) || n <= 0 || typeof r !== 'number' || !Number.isFinite(r)) return '';
  return `<div class="${cls}"><span aria-hidden="true">★</span> ${r.toFixed(1)} <span class="v-rating-n">· ${plural(n, 'review', 'reviews')}</span></div>`;
}

function photoWrap(imgHtml, v, full) {
  return `<div class="photo-wrap">${imgHtml}${statusPillHtml(v, full)}</div>`;
}

// "820 m · open until 2 am" / "2.1 km · opens 5 pm" once we know where the
// user is; falls back to the caller-supplied text (usually the area) when
// location isn't known
function venueLine(v, fallback) {
  // pending venues (no confirmed lat/lng yet) have nothing to measure a
  // distance to — fall back rather than compute a bogus "distance to null
  // island" number
  if (!state.userPos || v.lat == null || v.lng == null) return fallback;
  return `${fmtDist(haversine(state.userPos, v))} · ${openStatus(v).label}`;
}

// distance from the user, or null if either is unknown — never a bogus
// number for a pending venue's missing lat/lng (same guard as venueLine())
function distanceTo(v) {
  if (!state.userPos || v.lat == null || v.lng == null) return null;
  return haversine(state.userPos, v);
}

// default sort for every regular venue section and type list (see item 1,
// "Sorting becomes the default"): open venues first, nearest first when
// state.userPos is known; closed venues sink to the bottom, sorted nearest
// first within their own group the same way (mirrors sortEditorial()'s
// closed-group handling below) — a closed venue's distance still matters
// to someone deciding where to end up once it opens back up. Only the
// open/closed split itself is exempt from distance, never the ordering
// inside either group.
function sortForDisplay(list) {
  return [...list].sort((a, b) => {
    const aOpen = openStatus(a).open, bOpen = openStatus(b).open;
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    const da = distanceTo(a), db = distanceTo(b);
    return (da != null && db != null) ? da - db : 0;
  });
}

// On Fire / Busy Spots are Kar's editorial picks (state.picks.*), not a
// mechanical listing — item 1 is explicit that their curated order among
// the *open* venues must survive untouched (the featured #1 pick doesn't
// get bumped because something else is 200m closer). The only thing
// distance is allowed to do here is order the closed group, which would
// otherwise just be "whatever position Kar happened to list them in" —
// sinking to the bottom in *distance* order reads better than a frozen
// editorial order for a group that's explicitly not the featured picks
// right now. Same stable-sort trick as sortForDisplay(), mirrored: the
// open group's comparisons all return 0 (leaving Kar's order untouched),
// only the closed group is distance-compared.
function sortEditorial(list) {
  return [...list].sort((a, b) => {
    const aOpen = openStatus(a).open, bOpen = openStatus(b).open;
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    if (aOpen) return 0; // open: keep Kar's order exactly
    const da = distanceTo(a), db = distanceTo(b);
    return (da != null && db != null) ? da - db : 0;
  });
}

function parseHours(str) {
  if (!str) return null;
  const [a, b] = str.split('-');
  return { open: toMins(a), close: toMins(b) };
}
const toMins = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const fmtTime = m => {
  const h = Math.floor(m / 60) % 24, mm = m % 60;
  const ap = h >= 12 ? 'pm' : 'am';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return mm ? `${hh}:${String(mm).padStart(2, '0')} ${ap}` : `${hh} ${ap}`;
};

/* ---------- sheet: home ---------- */
function opensLate(v) {
  if (!v.hours) return false;
  const t = parseHours(v.hours[DAYS[new Date().getDay()]]);
  return !!t && t.close >= 1440;
}

function sectionCard(v, sub, photoOverride, sub2) {
  const photo = photoOverride || ((v.photos && v.photos.length) ? v.photos[0] : null);
  const thumb = photo
    ? `<img class="thumb" src="${esc(cloudinaryUrl(photo, 200))}" alt="" loading="lazy">`
    : `<img class="thumb" src="${venueTileUri(v.short_name || v.name, v.type, false)}" alt="" loading="lazy">`;
  // closed venues stay visible, just dimmed (item 1: never hide, someone
  // looking at 4pm for tonight still wants to see a bar that opens at 8)
  return `<div class="hcard${openStatus(v).open ? '' : ' closed'}" data-open-venue="${v.id}">
    ${photoWrap(thumb, v, true)}
    <div class="hc-body">
      <div style="font-size:12.5px;font-weight:700;">${esc(v.short_name || v.name)}</div>
      <div class="hc-sub" style="font-size:11px;color:var(--mute);">${esc(sub)}</div>
      ${sub2 ? `<div class="hc-sub" style="font-size:10.5px;color:var(--secondary);">${esc(sub2)}</div>` : ''}
      ${ratingLineHtml(v)}
      ${outdoorNoteHtml(v)}
    </div>
  </div>`;
}

// full-width photo-led card (Tonight, On fire): 16:9 photo, bold name,
// one status/distance sub-line beneath, whole card tappable. Name uses a
// class (not an inline style) specifically so the mobile Home redesign can
// retype it (16px/600) via CSS without touching this markup or desktop,
// which keeps reading the same class at its original 15px/700.
function bigCard(v, sub, photoOverride) {
  const photo = photoOverride || ((v.photos && v.photos.length) ? v.photos[0] : null);
  const media = photo
    ? `<img class="big-thumb" src="${esc(cloudinaryUrl(photo, 900))}" alt="" loading="lazy">`
    : `<img class="big-thumb" src="${venueTileUri(v.short_name || v.name, v.type, true)}" alt="" loading="lazy">`;
  // Sleek item 26: the Lao name leads, with "English name · distance"
  // beneath it. Every venue in the list carries a name_lo today, but a
  // submission that arrives without one keeps the card's old single-name
  // shape rather than leading with an empty line — and its sub-line keeps
  // the caller's own text, so nothing about that card changes.
  // Distance comes from distanceTo() rather than the caller's `sub`
  // (which is venueLine()'s "distance · status") because the status is
  // already on the photo's pill, and repeating it here is what made the
  // line too long to also carry a name.
  const lo = (v.name_lo || '').trim();
  const enName = esc(v.short_name || v.name);
  const d = distanceTo(v);
  const nameHtml = lo
    ? `<div class="cb-name lao">${esc(lo)}</div>`
    : `<div class="cb-name">${enName}</div>`;
  const subHtml = lo
    ? `${enName}${d != null ? ` · ${fmtDist(d)}` : (sub ? ` · ${sub}` : '')}`
    : sub;
  // closed venues stay visible, just dimmed (item 1: never hide, someone
  // looking at 4pm for tonight still wants to see a bar that opens at 8)
  return `<div class="card card-big${openStatus(v).open ? '' : ' closed'}" data-open-venue="${v.id}">
    ${photoWrap(media, v, true)}
    <div class="card-body">
      ${nameHtml}
      <div class="t-sub">${subHtml}</div>
      ${ratingLineHtml(v)}
      ${outdoorNoteHtml(v)}
    </div>
  </div>`;
}

// mobile Home only (Pass 2): a "row" card — thumb left, name + status/
// distance line right — same shape the type list (Bars/Cafes/All) already
// used, now shared by Busy spots/Coming up/Opening soon/Open late too on
// mobile, where they replace the .hcards side-scroll carousel (desktop
// keeps that carousel untouched — see the isMobile() branches in
// renderHomeSheet()). The status/distance line always renders — "every
// card gets" it, per the redesign brief — extraLine (event date/title,
// for Coming up) renders as an additional line above it, never in place of it.
// desktop's vertical list card — the type lists' and the All list's. Was
// written inline in renderHomeSheet()'s type-list branch; lifted out,
// unchanged, when All grew the same list, so the two cannot drift.
function plainListCardHtml(v) {
  const st = openStatus(v);
  const thumb = (v.photos && v.photos.length) ? `<img class="thumb" src="${esc(cloudinaryUrl(v.photos[0], 200))}" alt="" loading="lazy">` : `<img class="thumb" src="${venueTileUri(v.short_name || v.name, v.type, false)}" alt="" loading="lazy">`;
  return `
    <div class="card${st.open ? '' : ' closed'}" data-open-venue="${v.id}">
      ${photoWrap(thumb, v, false)}
      <div class="card-body">
        <span style="font-size:13.5px;font-weight:700;">${esc(v.short_name || v.name)}</span>
        <div class="t-sub">${venueLine(v, esc(v.area || ''))}</div>
        ${ratingLineHtml(v)}
        ${outdoorNoteHtml(v)}
      </div>
    </div>`;
}

function rowCard(v, extraLine) {
  const st = openStatus(v);
  const thumb = (v.photos && v.photos.length)
    ? `<img class="thumb" src="${esc(cloudinaryUrl(v.photos[0], 300))}" alt="" loading="lazy">`
    : `<img class="thumb" src="${venueTileUri(v.short_name || v.name, v.type, false)}" alt="" loading="lazy">`;
  // closed venues stay visible, just dimmed (item 1: never hide, someone
  // looking at 4pm for tonight still wants to see a bar that opens at 8)
  // Sleek item 31: the hours get a line of their own, in teal. --teal is
  // reserved for open-now status (see CLAUDE.md's tokens), so only an open
  // venue's line takes it — "closed" / "opens 6 pm" stay quiet instead of
  // borrowing the open colour to say the opposite.
  // That line now owns the status, so line 2 carries distance-or-area alone
  // rather than venueLine()'s "distance · status": with the photo's status
  // pill kept (item 25), the old line would have put three copies of the
  // same word on one card. Sleek item 30 (.row-card in style.css) is what
  // makes the thumbnail sit flush in the card's left edge.
  const d = distanceTo(v);
  const place = d != null ? fmtDist(d) : esc(v.area || '');
  return `<div class="card row-card${st.open ? '' : ' closed'}" data-open-venue="${v.id}">
    ${photoWrap(thumb, v, false)}
    <div class="card-body">
      <span class="t-name">${esc(v.short_name || v.name)}</span>
      ${extraLine ? `<div class="t-sub">${extraLine}</div>` : ''}
      ${place ? `<div class="t-sub">${place}</div>` : ''}
      <div class="t-hours${st.open ? ' open' : ''}">${esc(st.label)}</div>
      ${ratingLineHtml(v)}
      ${outdoorNoteHtml(v)}
    </div>
  </div>`;
}

// "Surprise me": a random OPEN venue of `filter`'s type (a chip type in
// VENUE_TYPE_META — see surpriseMeHtml(), the only filters it shows for),
// weighted toward nearby when location is known (nearest 8 rather than a
// flat citywide random, so "near" means something) — requests location
// first if it isn't already known, same as warmLocation()'s permission-
// respecting pattern (never triggers the browser prompt from a background
// tap, only from this explicit one)
async function quickSurpriseMe(filter) {
  if (!state.userPos) await requestLocation();
  const candidates = state.venues.filter(v =>
    v.pin_status !== 'pending' && v.lat != null && v.lng != null &&
    v.type === filter && openStatus(v).open);
  if (!candidates.length) { flashSurpriseMessage('nothing open right now — try later'); return; }
  let pool = candidates;
  if (state.userPos) {
    pool = [...candidates]
      .sort((a, b) => haversine(state.userPos, a) - haversine(state.userPos, b))
      .slice(0, Math.min(8, candidates.length));
  }
  openVenue(pool[Math.floor(Math.random() * pool.length)].id);
}

// swaps the Surprise me button's own label for a couple seconds instead of
// tapping doing nothing — same transient-label pattern as toggleRoute()'s
// "Route unavailable" state. Guards on the label still showing this exact
// message before reverting, in case a second tap (or leaving the screen and
// coming back) already moved it on to something else.
function flashSurpriseMessage(msg) {
  flashLabel(document.querySelector('[data-surprise-me] .surprise-label'), msg);
}

/* ---------- Cloudinary URLs: build the delivery URL a slot actually renders at */
// venues.photos / events.photo store "<version>/<publicId>" (see
// scripts/export-venues.js, functions/api/venues/[id].js), not full URLs —
// this is the one place that turns that into something an <img> can load,
// so cloud name and transform live here once instead of being repeated (or
// baked into stored rows, which is what made switching providers/transforms
// mean rewriting every row in the first place). Always applies
// q_auto,f_auto,dpr_auto plus the requested width; never reads a transform
// out of the stored value. If `stored` is already a full URL (unconverted
// row, or anything not hosted on Cloudinary), it's returned unchanged — a
// bad row degrades instead of breaking.
const CLOUDINARY_CLOUD_NAME = 'dzxg1vyi8';
// what a converted row actually looks like (see the migration note on
// SCHEMA_NOTES in scripts/export-venues.js) — anything else reaching here
// is either an unconverted full URL (handled above) or a data bug.
const CLOUDINARY_STORED_RE = /^v\d+\/.+$/;
function cloudinaryUrl(stored, width) {
  if (typeof stored !== 'string') return stored;
  if (/^https?:\/\//i.test(stored)) return stored;
  if (!CLOUDINARY_STORED_RE.test(stored)) {
    console.warn('cloudinaryUrl: stored value is neither a full URL nor "v<digits>/<publicId>":', stored);
  }
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/w_${width},q_auto,f_auto,dpr_auto/${stored}`;
}

// profile pictures only: square, centre-cropped to `size` — the circular
// mask itself is CSS (border-radius:50%, see .fl-avatar/#avatarSlot img), not
// baked into this transform, so the same stored photo works at any size
function cloudinaryAvatarUrl(stored, size) {
  if (typeof stored !== 'string') return stored;
  if (/^https?:\/\//i.test(stored)) return stored;
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_center,w_${size},h_${size},q_auto,f_auto,dpr_auto/${stored}`;
}

// dev-only guard for the bug class cloudinaryUrl() itself can't see: a call
// site that skips it entirely and drops a raw stored value straight into an
// <img src>, which the browser then resolves against our own origin instead
// of Cloudinary (exactly what happened to the On Fire / Tonight hero cards
// this was added for). data: is allowed — every no-photo placeholder tile
// (see venueTileUri()) is a data URI, not a bug. Reuses ?debug=1 rather than
// a separate flag (see DEBUG_GEO above).
if (DEBUG_GEO) {
  new MutationObserver(muts => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        const imgs = node.matches('img') ? [node] : [...node.querySelectorAll('img')];
        for (const img of imgs) {
          const src = img.getAttribute('src') || '';
          if (!/^(https?:|data:|\/)/.test(src)) {
            console.error('bad <img> src — looks like it skipped cloudinaryUrl():', src, img);
          }
        }
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

/* ---------- no-photo placeholder tile ---------- */
// shared by every no-photo spot in the app — list/collage/hcard thumbs, the
// venue sheet hero, event cards with no venue — plus reused as the
// onerror/timeout fallback for any venue <img> (see watchImgLoad) so a photo
// that fails to load reads the same as "no photos at all" instead of a
// blank grey box. Renders a type glyph (bar/cafe/venue) on a barely-tinted
// diagonal gradient with the initial small in the bottom-left, so it reads
// as a deliberate placeholder rather than missing data.
//
// Two aspect buckets (square vs. 16:9-ish "wide") rather than one shape
// stretched everywhere: object-fit:cover on a single square image would
// crop a bottom-anchored letter clean out of the widest slots (collage's
// big tile can hit ~2.4:1 depending on card width) — each bucket's letter
// position is kept inside the vertical band that survives cover-cropping
// at the aspect ratios these tiles actually render at.
const TILE_GLYPHS = {
  bar: '<polygon points="4,4 20,4 12,14"/><rect x="11" y="14" width="2" height="6"/><rect x="7" y="20" width="10" height="2" rx="1"/>',
  cafe: '<path d="M5 9h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5Z"/><path d="M16 11h2a2 2 0 0 1 0 4h-2" fill="none" stroke="currentColor" stroke-width="1.6"/><ellipse cx="11" cy="21.5" rx="8" ry="1.4"/>',
  venue: '<rect x="5" y="7" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 7 12 3 19 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  // PROPOSED — fork and spoon, not chopsticks or a cloche: spoon-and-fork is
  // how a Lao table is actually laid, and a cloche reads as hotel dining.
  // Same construction as the three above: solid fills for mass, 1.6 strokes
  // for line, 24-unit box, nothing finer than the cafe cup's handle.
  restaurant: '<path d="M5 3v5a3 3 0 0 0 6 0V3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M8 3v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><rect x="7.2" y="10.5" width="1.6" height="10.5" rx=".8"/><ellipse cx="16.5" cy="7" rx="3" ry="4.2"/><rect x="15.7" y="10.5" width="1.6" height="10.5" rx=".8"/>'
};

function mixHex(fromHex, toHex, amount) {
  const a = fromHex.replace('#', ''), b = toHex.replace('#', '');
  const chan = i => Math.round(parseInt(a.slice(i, i + 2), 16) + (parseInt(b.slice(i, i + 2), 16) - parseInt(a.slice(i, i + 2), 16)) * amount)
    .toString(16).padStart(2, '0');
  return `#${chan(0)}${chan(2)}${chan(4)}`;
}

function venueTileUri(name, type, wide, showLetter = true) {
  const letter = (name || '?').charAt(0).toUpperCase();
  const glyphKey = Object.hasOwn(TILE_GLYPHS, type) ? type : 'venue';
  // one neutral ink for all three types. This was --teal / --flame / --violet
  // per type, which meant every venue without a photo printed a saturated
  // letter and glyph into the list — the same map-token borrowing the chip
  // dots and the mood cards were doing, and the one with the most instances
  // on screen. The glyph still differs by type (TILE_GLYPHS above), and the
  // card carries the venue's name and type in text beside it; on the map,
  // where a marker has neither, the pin colours are untouched.
  const cs = getComputedStyle(document.documentElement);
  const fg = cs.getPropertyValue('--mute').trim() || '#8A8494';
  // light theme gets a hardcoded tan rather than the (near-white) --ink3
  // token — matches the rest of the app's light-theme surface treatment
  const bg1 = state.theme === 'light' ? '#DFD4BC' : (cs.getPropertyValue('--ink3').trim() || '#241E31');
  const bg2 = mixHex(bg1, fg, 0.12);
  const w = wide ? 160 : 100, h = wide ? 90 : 100;
  const size = Math.min(w, h) * 0.34;
  const gx = (w - size) / 2, gy = (h - size) / 2;
  const fontSize = wide ? h * 0.2 : h * 0.22;
  const lx = w * (wide ? 0.06 : 0.08), ly = h * (wide ? 0.8 : 0.86);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#g)"/>` +
    `<g transform="translate(${gx} ${gy})" fill="${fg}" fill-opacity="0.18" stroke-opacity="0.18" color="${fg}">` +
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24">${TILE_GLYPHS[glyphKey]}</svg></g>` +
    (showLetter ? `<text x="${lx}" y="${ly}" font-family="Space Grotesk, sans-serif" font-weight="700" font-size="${fontSize}" fill="${fg}">${esc(letter)}</text>` : '') +
    `</svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

/* ---------- shared loading indicator: flame-coloured expanding ring ---------- */
// the sweep (lring-sweep, on the arc) reads as progress, the widening
// (lring-spin rotating the whole ring while the arc's dashoffset breathes)
// as liveliness — see .lring rules in css/style.css. Inherits colour, so it
// needs a wrapper/ancestor with color set (var(--flame) unless the
// surrounding background is already flame-coloured, e.g. .btn-go, where it
// should inherit that button's existing --ink icon colour instead).
function loadingRing(size = 28) {
  return `<svg class="lring" width="${size}" height="${size}" viewBox="0 0 44 44" aria-hidden="true">
    <circle class="lring-track" cx="22" cy="22" r="18" fill="none"
            stroke="currentColor" stroke-width="3" opacity=".16"/>
    <circle class="lring-arc" cx="22" cy="22" r="18" fill="none"
            stroke="currentColor" stroke-width="3" stroke-linecap="round"
            stroke-dasharray="113" stroke-dashoffset="85"/>
  </svg>`;
}

// the photo-upload progress label (see wireVenuePhotoUpload()) wraps its
// live percentage in a loadingRing() rather than showing it as bare text
function uploadPctHtml(pct) {
  return `<span class="upload-pct">${loadingRing(22)}<span class="upload-pct-num">${pct}%</span></span>`;
}

/* ---------- photo lightbox ---------- */
// full-screen viewer shared by the venue sheet gallery and the owner edit
// form's photo thumbnails — a fresh, simple implementation (not the removed
// gallery overlay): natural aspect on a dark backdrop, swipe or arrow
// between photos, tap outside or × to close, Escape on desktop. Requests
// w_1600 (see cloudinaryUrl()) since this is the one place a photo needs to
// read at full size, not the thumbnail width every other call site uses.
let lightbox = null; // { photos, index, ov } while open, else null

function lightboxRender() {
  const { photos, index, ov } = lightbox;
  const img = ov.querySelector('.lightbox-img');
  img.src = cloudinaryUrl(photos[index], 1600);
  img.alt = `Photo ${index + 1} of ${photos.length}`;
  ov.querySelector('.lightbox-count').textContent = photos.length > 1 ? `${index + 1} / ${photos.length}` : '';
  ov.querySelector('.lightbox-prev').hidden = photos.length <= 1;
  ov.querySelector('.lightbox-next').hidden = photos.length <= 1;
}

function lightboxStep(delta) {
  if (!lightbox) return;
  lightbox.index = (lightbox.index + delta + lightbox.photos.length) % lightbox.photos.length;
  lightboxRender();
}

function lightboxKeydown(e) {
  if (!lightbox) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft') lightboxStep(-1);
  else if (e.key === 'ArrowRight') lightboxStep(1);
}

function closeLightbox() {
  if (!lightbox) return;
  const { ov } = lightbox;
  document.removeEventListener('keydown', lightboxKeydown);
  ov.classList.remove('show');
  setTimeout(() => ov.remove(), 200);
  lightbox = null;
}

// photos: array of stored "<version>/<publicId>" values; index: which one
// to open on. Safe to call with an empty/missing array (no-ops) so a
// click handler doesn't need its own guard.
function openLightbox(photos, index) {
  if (!photos || !photos.length) return;
  closeLightbox(); // guard against a stray double-open
  const ov = document.createElement('div');
  ov.className = 'lightbox';
  ov.innerHTML = `
    <button type="button" class="lightbox-close" aria-label="Close">✕</button>
    <button type="button" class="lightbox-prev" aria-label="Previous photo">‹</button>
    <img class="lightbox-img" alt="">
    <!-- alt is filled in by lightboxRender() once the index is known -->
    <button type="button" class="lightbox-next" aria-label="Next photo">›</button>
    <div class="lightbox-count"></div>`;
  document.body.appendChild(ov);
  lightbox = { photos, index, ov };
  lightboxRender();
  // double rAF — see showMoodIntro()'s comment; single rAF let this same
  // append+show sequence get stuck mid-transition
  requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add('show')));

  // tap outside the image (the backdrop itself) closes, same as ×
  ov.addEventListener('click', (e) => { if (e.target === ov) closeLightbox(); });
  ov.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
  ov.querySelector('.lightbox-prev').addEventListener('click', () => lightboxStep(-1));
  ov.querySelector('.lightbox-next').addEventListener('click', () => lightboxStep(1));
  document.addEventListener('keydown', lightboxKeydown);

  // dy is recorded and compared, not just dx: the old test was |dx| > 40 with
  // no vertical term at all, so a drag the user meant as vertical — scrolling
  // the page behind, or just a thumb arcing on its way somewhere — stepped to
  // the next photo on 40px of sideways drift. Requiring the horizontal
  // component to exceed the vertical one is the minimum that makes this a
  // horizontal gesture rather than "any gesture with 40px of x in it".
  let touchStartX = null, touchStartY = null;
  ov.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  ov.addEventListener('touchend', (e) => {
    if (touchStartX == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) lightboxStep(dx > 0 ? -1 : 1);
    touchStartX = touchStartY = null;
  }, { passive: true });
}

// wires the fallback for one <img>: onerror swaps in the monogram
// immediately; a 6s watchdog covers requests that never fire load OR error
// (a stalled connection, a host that hangs) since a blank box is worse than
// a letter. onSettled(ok) — used by watchCollageCard() for hero promotion —
// fires once either way, after any monogram swap has already happened.
function watchImgLoad(img, v, onSettled) {
  // re-arms cleanly if called again on an img whose src just changed — the
  // venue sheet's collage tiles are re-rendered and re-watched on every
  // openVenue(), including a sticky re-open of the venue already showing
  delete img.dataset.settled;
  delete img.dataset.monogram;
  const finish = (ok) => {
    if (img.dataset.settled === '1') return;
    img.dataset.settled = '1';
    img.closest('.collage-tile')?.classList.remove('is-loading');
    if (!ok) {
      console.warn('[muan] image failed to load:', img.src);
      img.dataset.monogram = '1';
      img.onerror = null;
      const wide = img.classList.contains('big-thumb');
      img.src = venueTileUri(v.short_name || v.name, v.type, wide);
    }
    onSettled?.(ok);
  };
  img.addEventListener('load', () => finish(true), { once: true });
  img.addEventListener('error', () => finish(false), { once: true });
  setTimeout(() => { if (!img.complete || img.naturalWidth === 0) finish(false); }, 6000);
}

// collage-specific: if the big hero tile's photo fails but a smaller tile's
// photo is (or later becomes) available, promote that photo into the hero
// slot rather than leaving the hero on its monogram while a real photo sits
// unused in a small tile next to it. Runs on every image's settle (load
// order between tiles isn't guaranteed) so it catches whichever image
// resolves last, in either direction.
function watchCollageCard(cardEl, v) {
  const heroImg = cardEl.querySelector('.collage-tile-big img');
  const otherImgs = [...cardEl.querySelectorAll('.collage-tile:not(.collage-tile-big) img')];
  if (!heroImg) { otherImgs.forEach(img => watchImgLoad(img, v)); return; }

  const tryPromote = () => {
    if (heroImg.dataset.monogram !== '1' || heroImg.dataset.promoted === '1') return;
    const good = otherImgs.find(img => img.dataset.settled === '1' && img.dataset.monogram !== '1');
    if (!good) return;
    heroImg.dataset.promoted = '1';
    heroImg.src = good.src;
  };

  watchImgLoad(heroImg, v, tryPromote);
  otherImgs.forEach(img => watchImgLoad(img, v, tryPromote));
}

// swaps a card's tiles from their placeholder monogram src to their real
// (already width-rewritten, see cloudinaryUrl()) photo URL, then arms
// the load/error/timeout fallback for those real requests — called once per
// card, when that card's IntersectionObserver decides it's actually time to
// load it (observeCollageCards() for the Recommended café list, vibePopObserver
// in openVibePop() for the mood popup)
function loadCollageCardPhotos(cardEl, v) {
  cardEl.querySelectorAll('img[data-src]').forEach(img => {
    img.src = img.dataset.src;
    delete img.dataset.src;
    // shows the ring centred on the still-visible monogram until this
    // tile's real request settles (watchImgLoad()'s finish() clears it)
    img.closest('.collage-tile')?.classList.add('is-loading');
  });
  watchCollageCard(cardEl, v);
}

// pinned-state affordance for the sticky chip bar (see #sheet .chip-bar in
// style.css) — an IntersectionObserver on a 1px-tall sentinel placed just
// above it, rather than a scroll listener: no per-scroll-frame handler on
// exactly the phones this bar's pinning bug was reported on. When the
// sentinel scrolls out of view the bar has stuck; toggling .pinned adds the
// hairline that makes the stuck state read as intentional rather than a
// rendering glitch.
let chipPinObserver = null;
function observeChipPin() {
  chipPinObserver?.disconnect();
  const sentinel = document.getElementById('chipSentinel');
  if (!sentinel) return;
  chipPinObserver = new IntersectionObserver(([entry]) => {
    chipBarEl.classList.toggle('pinned', !entry.isIntersecting);
  }, { root: document.getElementById('sheet'), threshold: 0 });
  chipPinObserver.observe(sentinel);
}

// ~15 photo requests firing at once across five collage cards blew past the
// browser's per-host connection limit and most just sat at complete=false
// indefinitely (see the MEASURED note this was written for). Each card's
// <img> starts on a monogram placeholder with the real URL parked in
// data-src (see collagePhotosHtml()); this loads a card's real photos only
// once it's within ~200px of becoming visible. root must be #sheet, not the
// window — #sheet is the element that actually scrolls (see its overflow-y
// in style.css), so viewport-rooted intersection would report every card as
// always "visible". IntersectionObserver fires immediately for whatever's
// already in range when observe() is called, so the first card (or few,
// depending on sheet height) loads right away with no special-casing.
// Scoped to #sheet .collage-card, not every .collage-card in the document —
// the mood popup's own cards (vibePopObserver, see openVibePop()) live in
// document.body, outside #sheet, so an unscoped query here would also
// (harmlessly, since #sheet isn't their ancestor) try to observe those.
let collageObserver = null;
function observeCollageCards() {
  collageObserver?.disconnect();
  collageObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      collageObserver.unobserve(entry.target);
      const v = venueById(entry.target.dataset.openVenue);
      if (v) loadCollageCardPhotos(entry.target, v);
    }
  }, { root: document.getElementById('sheet'), rootMargin: '200px' });
  document.querySelectorAll('#sheet .collage-card').forEach(card => collageObserver.observe(card));
}

/* ---------- Photo-collage cards: shared by the Recommended café list and the mood popup ---------- */
// "closed" already says so on its own (openStatus() covers "closed today" /
// "closed" / "hours unconfirmed" / a venue's own hours_note); only the
// not-yet-open case ("opens 10 am") needs a "closed ·" prefix to read
// honestly at a glance
function collageStatusLine(v) {
  const st = openStatus(v);
  const statusPart = (st.open || /^closed/.test(st.label) || !v.hours)
    ? st.label
    : `closed · ${st.label}`;
  // reachable in principle even for a pending venue (no confirmed lat/lng —
  // see CLAUDE.md's pin_status rule) reached via openVibePop()'s unfiltered
  // café list — same null-coordinate guard as venueLine()
  return (state.userPos && v.lat != null && v.lng != null)
    ? `${statusPart} · ${fmtDist(haversine(state.userPos, v))}`
    : statusPart;
}

// truncates the long description to ~80 chars at a word boundary — the
// full text belongs on the venue sheet, not this card
function collageDescLine(v) {
  const d = (v.description || '').trim();
  if (!d) return '';
  return d.length <= 80 ? d : d.slice(0, 80).replace(/\s+\S*$/, '') + '…';
}

// 1 large photo across the top (~55%), up to 2 more side by side beneath
// (~45%) — degrades cleanly as photos run out: 2 photos = one large plus
// one wide beneath. A 4th+ photo folds into a "+N" badge on the last tile
// rather than growing the grid further.
//
// every tile starts on the venue's monogram as its actual src (a data URI —
// no request fires) with the real, size-rewritten photo URL parked in
// data-src; whichever IntersectionObserver owns this card (observeCollageCards()
// for the Recommended tab, vibePopObserver for the mood popup) swaps it in
// once the card is about to scroll into view (see loadCollageCardPhotos()),
// rather than every tile across every card requesting a photo the moment
// the list or popup opens.
function collagePhotosHtml(v, altName) {
  const photos = v.photos || [];
  // showLetter:false — this placeholder fills the whole "solo" tile
  // (object-fit:cover, no fixed aspect match), and object-fit:cover on a
  // wide 160:90 SVG crops/rescales the corner letter to wherever a given
  // card's actual rendered aspect puts it; at the popup's short card height
  // that lands the letter right on top of the real .collage-name/.collage-
  // status text below it (MEASURED: on Farsai/Drip 1920s, both photo-less).
  // The real venue name is already shown as text over this image, so the
  // decorative letter is redundant here — dropping it removes the collision
  // outright instead of chasing a safe position that only holds for one
  // specific card height. Every other venueTileUri() call site is
  // unaffected (showLetter defaults to true).
  const phBig = venueTileUri(v.short_name || v.name, v.type, true, false);
  if (!photos.length) {
    return `<div class="collage-photos"><div class="collage-tile collage-tile-big solo">
      <img src="${phBig}" alt="${esc(altName)}"></div></div>`;
  }
  const phSmall = venueTileUri(v.short_name || v.name, v.type, false);
  const n = Math.min(photos.length, 3);
  const extra = photos.length - 3;
  const ring = `<span class="tile-loading">${loadingRing(24)}</span>`;
  let html = `<div class="collage-photos">`;
  html += `<div class="collage-tile collage-tile-big${n === 1 ? ' solo' : ''}">
    <img src="${phBig}" data-src="${esc(cloudinaryUrl(photos[0], 600))}" alt="${esc(altName)}" loading="lazy" draggable="false">${ring}</div>`;
  if (n >= 2) {
    const more = n >= 3 && extra > 0 ? extra : null;
    html += `<div class="collage-row">
      <div class="collage-tile"><img src="${phSmall}" data-src="${esc(cloudinaryUrl(photos[1], 300))}" alt="" loading="lazy" draggable="false">${ring}</div>
      ${n >= 3 ? `<div class="collage-tile">
        <img src="${phSmall}" data-src="${esc(cloudinaryUrl(photos[2], 300))}" alt="" loading="lazy" draggable="false">
        ${ring}
        ${more ? `<span class="collage-more">+${more}</span>` : ''}
      </div>` : ''}
    </div>`;
  }
  html += `</div>`;
  return html;
}

// whole-card-tappable collage card, shared by the Cafes › Recommended tab
// and the mood popup's result list (see openVibePop()) — on the Recommended
// tab this is ordinary #sheet content, so [data-open-venue] just works via
// setSheet()'s delegation; the popup lives outside #sheet entirely, so
// openVibePop() wires that same attribute's click handling itself
function collageCardHtml(v) {
  const photos = v.photos || [];
  const descLine = collageDescLine(v);
  const facts = [];
  if (v.contact?.phone) facts.push('📞');
  if (v.parking?.note) facts.push('🅿');
  if (photos.length) facts.push(`${photos.length} photo${photos.length === 1 ? '' : 's'}`);
  // closed venues stay visible, just dimmed (item 1: never hide, someone
  // looking at 4pm for tonight still wants to see a bar that opens at 8)
  return `
    <div class="collage-card${openStatus(v).open ? '' : ' closed'}" data-open-venue="${v.id}">
      ${collagePhotosHtml(v, v.name)}
      ${statusPillHtml(v, true)}
      <div class="collage-scrim"></div>
      <div class="collage-info">
        <div class="collage-name">${esc(v.short_name || v.name)}</div>
        <div class="collage-status">${esc(collageStatusLine(v))}</div>
        ${ratingLineHtml(v)}
        ${descLine ? `<div class="collage-desc">${esc(descLine)}</div>` : ''}
        ${outdoorNoteHtml(v)}
        ${facts.length ? `<div class="collage-facts">${facts.map(f => `<span>${esc(f)}</span>`).join('')}</div>` : ''}
      </div>
    </div>`;
}

/* ---------- Mood chooser: first-open greeting + result popup ---------- */
// display copy for the fixed vocabulary in functions/api/_venue-validation.js
// VIBE_TAGS — kept as a separate array (not imported, this is a plain
// script with no module system) since it pairs each key with the label
// shown here; the allowed-values list itself lives server-side and is
// re-derived from whatever data actually shows up in state.venues, not
// hardcoded here, so a key mismatch would just show a 0-count tag rather
// than silently misbehave. label_lo stays null until Kar writes it himself —
// do not machine-translate (see CLAUDE.md).
const VIBE_TAGS = [
  { key: 'under-trees', label: 'Under the trees', label_lo: null }, // TODO(Kar): Lao label
  { key: 'tucked-away', label: 'Small and quiet', label_lo: null }, // TODO(Kar): Lao label
  { key: 'for-coffee', label: 'For the coffee', label_lo: null }, // TODO(Kar): Lao label
  { key: 'settle-in', label: 'Stay a long time', label_lo: null }, // TODO(Kar): Lao label
];

// one flat, no-outline SVG per mood tag — every fill is a CSS custom
// property (see .mc-canopy/.mc-building/etc. in style.css and the --mc-*
// tokens near the top of that file), never a hardcoded hex, so these track
// the real theme correctly, in the mood popup and in the intro carousel
// alike (the carousel used to be pinned to the dark palette and is not any
// more — see the .mood-intro comment in style.css).
// Grouped elements (.mc-canopy-group, .mc-books) exist purely so their
// one-time entry animation (see the .mc-enter rules in style.css) can
// move/scale the whole cluster together rather than each shape animating
// from its own separate origin. Two stroked paths (the steam curls) are
// the only non-fill shapes here — see the CSS comment on why that's not
// the "no outlines" a flat icon border would be.
const MOOD_ILLUS = {
  'under-trees': `<svg viewBox="0 0 100 60" class="mc-illus" aria-hidden="true">
    <ellipse class="mc-dapple" cx="30" cy="54" rx="10" ry="3"/>
    <ellipse class="mc-dapple" cx="55" cy="56" rx="14" ry="3"/>
    <ellipse class="mc-dapple" cx="75" cy="53" rx="9" ry="2.5"/>
    <rect class="mc-trunk" x="27" y="34" width="3" height="20"/>
    <rect class="mc-trunk" x="52" y="30" width="3" height="24"/>
    <rect class="mc-trunk" x="72" y="36" width="3" height="18"/>
    <g class="mc-canopy-group">
      <circle class="mc-canopy mc-canopy-1" cx="73" cy="26" r="17"/>
      <circle class="mc-canopy mc-canopy-2" cx="28" cy="24" r="18"/>
      <circle class="mc-canopy" cx="52" cy="18" r="20"/>
    </g>
  </svg>`,
  'tucked-away': `<svg viewBox="0 0 100 60" class="mc-illus" aria-hidden="true">
    <rect class="mc-building" x="0" y="0" width="38" height="60"/>
    <rect class="mc-building" x="62" y="0" width="38" height="60"/>
    <rect class="mc-glow" x="42" y="34" width="16" height="26"/>
    <rect class="mc-sign-rod" x="44" y="15" width="12" height="1.6"/>
    <rect class="mc-sign" x="45" y="16.6" width="10" height="7"/>
  </svg>`,
  'for-coffee': `<svg viewBox="0 0 100 60" class="mc-illus" aria-hidden="true">
    <path class="mc-steam" d="M40 26 C36 22 44 18 40 14 C37 11 43 8 41 5"/>
    <path class="mc-steam" d="M50 24 C46 20 54 16 50 12 C47 9 53 6 51 3"/>
    <path class="mc-steam" d="M60 26 C56 22 64 18 60 14 C57 11 63 8 61 5"/>
    <ellipse class="mc-saucer" cx="50" cy="50" rx="30" ry="6"/>
    <path class="mc-cup" d="M28 30 H72 L65 48 Q50 55 35 48 Z"/>
    <path class="mc-cup" d="M71 33 Q86 33 86 40 Q86 47 71 44 Z"/>
  </svg>`,
  'settle-in': `<svg viewBox="0 0 100 60" class="mc-illus" aria-hidden="true">
    <g class="mc-books">
      <rect class="mc-book" x="76" y="46" width="20" height="6"/>
      <rect class="mc-book mc-book-2" x="78" y="40" width="16" height="6"/>
      <rect class="mc-book mc-book-3" x="77" y="34" width="18" height="6"/>
    </g>
    <rect class="mc-chair" x="16" y="8" width="22" height="38" rx="9" transform="rotate(-7 27 27)"/>
    <rect class="mc-chair" x="14" y="36" width="48" height="14" rx="6"/>
    <rect class="mc-chair" x="54" y="22" width="14" height="26" rx="7"/>
    <rect class="mc-chair" x="18" y="48" width="4" height="6" rx="1"/>
    <rect class="mc-chair" x="58" y="48" width="4" height="6" rx="1"/>
  </svg>`,
};

// step 1 of the mood slide (see showMoodIntro()) — which kind of place,
// asked before which mood. Kept as data rather than markup so restaurants
// and hotels are a line each here and not a redesign: the grid is a
// 2-column auto-fit (see .ms-type-cards in style.css), which lays 2 cards
// out side by side and 4 as a 2x2 with no other change.
//
// moods:false means this type has no vibe vocabulary yet, so a mood grid
// would be four 0-count cards and a dead end. Such a type gets the
// editorial lists instead (TYPE_LISTS below) as its step 2 — same slide,
// same card shell, same results popup. Only if those come back empty too
// does picking the type close the intro and drop the person into that
// type's own list, because an empty screen is worse than no screen. Flip
// moods to true the moment Kar starts tagging that type
// (migrations/013_vibe.sql) and the mood grid takes over on its own.
//
// label_lo here was written by Kar in the task that added this step, not
// machine-translated — see CLAUDE.md, and VIBE_TAGS above, whose own Lao
// labels are still waiting on him.
const MOOD_TYPES = [
  { key: 'cafe', label: 'Cafés', label_lo: 'ຄາເຟ', moods: true },
  { key: 'bar', label: 'Bars', label_lo: 'ບາຣ໌', moods: false },
];

// one illustration per type card, under the same rules as MOOD_ILLUS above:
// flat fills only, every colour a CSS custom property, nothing hardcoded.
// Cafés reuse the mood grid's cup verbatim — the type card just gives it
// more room (see .ms-type-card .vibe-card-illus). Bars get a bottle and a
// glass, drawn to match: same 100x60 viewBox, same ground-ellipse-plus-
// objects composition as the cup on its saucer.
const MOOD_TYPE_ILLUS = {
  cafe: MOOD_ILLUS['for-coffee'],
  bar: `<svg viewBox="0 0 100 60" class="mc-illus" aria-hidden="true">
    <ellipse class="mc-bar-floor" cx="50" cy="53" rx="36" ry="4.5"/>
    <g class="mc-bottle">
      <rect class="mc-bottle-cap" x="30" y="2" width="9" height="4.5" rx="1.5"/>
      <rect class="mc-bottle-neck" x="31.2" y="6" width="6.6" height="14"/>
      <path class="mc-bottle-body" d="M31.2 19 C31.2 24 23 27 23 35 V48 Q23 52 27 52 H42 Q46 52 46 48 V35 C46 27 37.8 24 37.8 19 Z"/>
      <rect class="mc-bottle-label" x="24" y="34" width="21" height="9"/>
    </g>
    <g class="mc-glass">
      <path class="mc-glass-body" d="M57 25 H83 L80 52 H60 Z"/>
      <path class="mc-drink" d="M58.6 39 H81.4 L80 52 H60 Z"/>
      <rect class="mc-ice" x="66" y="40" width="8" height="8" rx="1.5" transform="rotate(-14 70 44)"/>
      <rect class="mc-straw" x="76" y="16" width="2.6" height="20" rx="1.3" transform="rotate(15 77.3 26)"/>
    </g>
  </svg>`,
};

// re-runs a CSS entry animation on an element that may already be carrying
// the class — adding a class that is already present does not restart an
// animation, so it has to come off, force a reflow, and go back on. Was
// inline in showMoodIntro()'s scroll listener; now shared by that and by
// the two-step swap (showStep()), which needs the same trick.
function restartAnim(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// one card in the type grid — the same .vibe-card shell as vibeCardHtml()
// below, so border, press feedback, disabled state and the entry stagger
// all come from rules that grid already has; only the size and the bigger
// illustration are its own (.ms-type-card). The count is a plain count of
// that type in state.venues: real data, not a popularity figure (CLAUDE.md).
function typeCardHtml(t) {
  const count = state.venues.filter(v => v.type === t.key).length;
  const lo = t.label_lo ? ` · <span class="lao">${esc(t.label_lo)}</span>` : '';
  return `<button type="button" class="vibe-card ms-type-card" data-mood-type="${t.key}" ${count === 0 ? 'disabled' : ''}>
    <span class="vibe-card-illus">${MOOD_TYPE_ILLUS[t.key] || ''}</span>
    <span class="vibe-card-body">
      <span class="vibe-card-label">${esc(t.label)}${lo}</span>
      <span class="vibe-card-count">${count} place${count === 1 ? '' : 's'}</span>
    </span>
  </button>`;
}

// one card in the mood grid — shared by showMoodIntro() below. A 0-match
// card stays visible but disabled (native [disabled], so it's inert
// without an extra click guard) rather than hidden. The illustration is
// fixed per mood tag (MOOD_ILLUS above), not per matching venue, so unlike
// the old photo-backed cards there's no per-venue lookup or photo-load
// fallback needed here any more. `venues` is the already-type-filtered pool
// the counts are taken from (see fillMoodStep() inside showMoodIntro()), so
// the same card serves cafés, bars, or whatever MOOD_TYPES grows next.
function vibeCardHtml(t, venues) {
  const count = venues.filter(v => (v.vibe || []).includes(t.key)).length;
  return `<button type="button" class="vibe-card" data-vibe-tag="${t.key}" ${count === 0 ? 'disabled' : ''}>
    <span class="vibe-card-illus">${MOOD_ILLUS[t.key]}</span>
    <span class="vibe-card-body">
      <span class="vibe-card-label">${esc(t.label)}</span>
      <span class="vibe-card-count">${count} place${count === 1 ? '' : 's'}</span>
    </span>
  </button>`;
}

/* ---------- Step 2 for a type with no moods: editorial lists ---------- */
// Bars are the case that forced this: not one bar carries a vibe tag, so
// the mood grid would be four 0-count cards. These two lists take its
// place in the same slide, same card shell, same results popup.
//
// "Our picks" is deliberately NOT called "Trending". Phase 1 has no
// check-in volume, so a trending label would be a popularity claim with
// nothing behind it (CLAUDE.md). It is the same hand-curated picks.json
// list On Fire draws on, and the label says so.
//
// venues(type) returns the list already ordered, because the two orderings
// differ: picks are editorial and keep Kar's order among the open venues
// (sortEditorial(), same as On Fire), while newly-opened is a mechanical
// date filter and sorts open-then-nearest like any other list
// (sortForDisplay()).
//
// Pending venues: excluded from Our picks, which is editorial and covered
// by CLAUDE.md's pin_status rule; kept in Newly opened, which is a list
// section, and the same rule says those still show a pending submission.
const NEWLY_OPENED_MONTHS = 6;

const TYPE_LISTS = [
  {
    key: 'our-picks', label: 'Our picks', label_lo: 'ທີ່ພວກເຮົາເລືອກ',
    venues: (type) => sortEditorial((state.picks?.venue_ids || [])
      .map(venueById).filter(Boolean)
      .filter(v => v.type === type && v.pin_status !== 'pending')),
  },
  {
    key: 'newly-opened', label: 'Newly opened', label_lo: 'ເປີດໃໝ່',
    venues: (type) => sortForDisplay(state.venues
      .filter(v => v.type === type && openedWithinMonths(v, NEWLY_OPENED_MONTHS))),
  },
];

// "recently opened" reads an OPTIONAL `opened` field — "YYYY-MM" when only
// the month is known, "YYYY-MM-DD" when the day is. No venue carries it
// yet, so today this list comes back empty and its card is hidden (see
// typeListsFor()); it fills in by itself the moment Kar starts recording
// opening dates, with no other change here.
//
// `source` is NOT used for this and must not be. Its date is when Kar last
// looked at the listing ("Google Maps listing, 2026-07-25"), not when the
// place opened — reading one as the other would invent an opening date for
// every venue in the file, which is exactly what CLAUDE.md forbids. An
// unparseable or missing value is false, never a guess.
//
// A future date is false too: something that has not opened yet is not
// newly opened (the app has a separate status:'opening-soon' for that).
function openedWithinMonths(v, months) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(v.opened || '').trim());
  if (!m) return false;
  const opened = new Date(Date.UTC(+m[1], +m[2] - 1, +(m[3] || 1)));
  if (Number.isNaN(opened.getTime())) return false;
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - months);
  return opened <= now && opened >= cutoff;
}

// the step-2 lists that actually have something in them, each paired with
// its venues so the card can show a real count without resolving twice. An
// empty list is dropped rather than shown as a 0 — a disabled 0-count card
// is honest for a mood (the tag exists, nothing carries it), but "Newly
// opened · 0" reads as a broken feature, and with only two cards here a
// dead one is half the screen.
function typeListsFor(type) {
  return TYPE_LISTS
    .map(def => ({ def, venues: def.venues(type) }))
    .filter(x => x.venues.length > 0);
}

// one illustration per list, under the same rules as MOOD_ILLUS above:
// flat fills only, every colour a CSS custom property, nothing hardcoded.
// Both reuse classes the existing drawings already define (.mc-bottle-*
// from the Bars type card, .mc-building/.mc-glow/.mc-sign from the
// tucked-away mood), so they track both themes with no new tokens.
const TYPE_LIST_ILLUS = {
  // three bottles, the middle one pulled forward: a few chosen out of the
  // shelf. No flame and no arrow — this is a curated shortlist, not a
  // popularity ranking, and the drawing should not claim otherwise.
  'our-picks': `<svg viewBox="0 0 100 60" class="mc-illus" aria-hidden="true">
    <ellipse class="mc-bar-floor" cx="50" cy="53" rx="38" ry="4.5"/>
    <g class="mc-pick-side">
      <rect class="mc-bottle-neck" x="14.5" y="17" width="5" height="10"/>
      <path class="mc-bottle-body" d="M14.5 26 C14.5 30 9 32.5 9 38.5 V49 Q9 52 12 52 H22 Q25 52 25 49 V38.5 C25 32.5 19.5 30 19.5 26 Z"/>
    </g>
    <g class="mc-pick-side">
      <rect class="mc-bottle-neck" x="80.5" y="17" width="5" height="10"/>
      <path class="mc-bottle-body" d="M80.5 26 C80.5 30 75 32.5 75 38.5 V49 Q75 52 78 52 H88 Q91 52 91 49 V38.5 C91 32.5 85.5 30 85.5 26 Z"/>
    </g>
    <g class="mc-pick-hero">
      <rect class="mc-bottle-cap" x="44" y="2" width="12" height="5" rx="1.6"/>
      <rect class="mc-bottle-neck" x="45.6" y="6.5" width="8.8" height="13.5"/>
      <path class="mc-bottle-body" d="M45.6 19.5 C45.6 25 36 28.5 36 37 V48 Q36 52 40 52 H60 Q64 52 64 48 V37 C64 28.5 54.4 25 54.4 19.5 Z"/>
      <rect class="mc-bottle-label" x="37.5" y="35" width="25" height="9.5"/>
    </g>
  </svg>`,
  // a lit doorway under a fresh sign, with two sparks: the lights just went
  // on here. Shares the tucked-away mood's building/glow/sign classes on
  // purpose — same visual language, one door instead of an alley.
  'newly-opened': `<svg viewBox="0 0 100 60" class="mc-illus" aria-hidden="true">
    <rect class="mc-building" x="19" y="11" width="62" height="49"/>
    <rect class="mc-sign-rod" x="15" y="11" width="70" height="3"/>
    <rect class="mc-sign" x="36" y="17" width="28" height="8"/>
    <rect class="mc-glow" x="40" y="31" width="20" height="29"/>
    <path class="mc-spark" d="M11 22 L13.4 28.6 L20 31 L13.4 33.4 L11 40 L8.6 33.4 L2 31 L8.6 28.6 Z"/>
    <path class="mc-spark mc-spark-2" d="M88 13 L89.6 17.4 L94 19 L89.6 20.6 L88 25 L86.4 20.6 L82 19 L86.4 17.4 Z"/>
  </svg>`,
};

// one card in the step-2 list grid. Same .ms-type-card shell as the type
// step's own two cards — border, press feedback and the entry stagger all
// come from rules that grid already has, and two cards laid out the way
// two cards were already laid out one step earlier. No disabled state: an
// empty list never reaches here (see typeListsFor()). The count is a plain
// count of the venues in the list, not a popularity figure (CLAUDE.md).
function listCardHtml(def, venues) {
  const lo = def.label_lo ? ` · <span class="lao">${esc(def.label_lo)}</span>` : '';
  return `<button type="button" class="vibe-card ms-type-card" data-list-key="${def.key}">
    <span class="vibe-card-illus">${TYPE_LIST_ILLUS[def.key] || ''}</span>
    <span class="vibe-card-body">
      <span class="vibe-card-label">${esc(def.label)}${lo}</span>
      <span class="vibe-card-count">${venues.length} place${venues.length === 1 ? '' : 's'}</span>
    </span>
  </button>`;
}

// true once any venue at all has a vibe tag — Kar fills these in by hand
// (see migrations/013_vibe.sql), so a fresh deploy starts with none. Gates
// both showMoodIntro() (no point greeting someone into a wall of 0-count
// disabled cards) and moodRelinkHtml()'s bottom-of-list link.
function anyVibeTagged() {
  return state.venues.some(v => (v.vibe || []).length > 0);
}

// the 3 welcome panels that now precede the mood question (see
// showMoodIntro()) — Cloudinary public IDs only, same "v<digits>/<publicId>"
// shape as venue/event photos, rendered through cloudinaryUrl() rather than
// a hardcoded full URL (see CLAUDE.md). titleLao marks slide 1's heading as
// Lao script (gets the .lao font-feature class); slides 2-3 don't have a
// Lao heading yet — TODO(Kar): write and add one for each.
//
// Two illustrations per panel — night scenes for the dark theme, daytime
// cream ones for the light theme — held on the one slide definition rather
// than in a second parallel array. A second array would have to be kept the
// same length and in the same order as this one by hand, with nothing to
// catch it drifting; here a panel's copy and both of its images move
// together. welcomePhoto() picks between them at render time.
const WELCOME_SLIDES = [
  {
    photoDark: 'v1788009913/ChatGPT_Image_Aug_29_2026_06_31_59_PM_vivr57',
    photoLight: 'v1788348856/cafecard1_egqeb6',
    title: 'ໄປໃສດີ?', titleLao: true,
    sub: 'Find places to go in Vientiane.',
  },
  {
    photoDark: 'v1788009913/ChatGPT_Image_Aug_29_2026_06_37_27_PM_kvbxej',
    // PLACEHOLDER, until this one is regenerated: the signage in it is not
    // real Lao, and the scene shows water that is not there.
    photoLight: 'v1788348889/ilustait2_u0sfrv',
    title: 'Checked by us', titleLao: false,
    sub: 'Real opening times and real photos.',
  },
  {
    photoDark: 'v1788009908/ChatGPT_Image_Aug_29_2026_06_38_56_PM_gmszju',
    photoLight: 'v1788348856/cafecard2_tuubpu',
    title: 'See what is near you', titleLao: false,
    sub: 'Find the way there on the map.',
  },
];

// which of a panel's two illustrations the current theme wants. Reads
// state.theme — the resolved 'light'/'dark' the rest of the app renders
// from, set by initTheme()/applyTheme() — rather than taking the theme as a
// parameter at every call site, so the carousel cannot end up showing the
// night set on a cream page. Falls back to the night set if state.theme is
// somehow unset: that is the pair this flow shipped with.
function welcomePhoto(s) {
  return state.theme === 'light' ? s.photoLight : s.photoDark;
}

// page dots, rendered once per welcome panel rather than once for the whole
// flow. "Below the illustration, just above the copy" is a position that
// only exists inside a slide, and .mi-viewport scrolls, so a single shared
// row could not sit there — it would either scroll away with one slide or
// have to be absolutely positioned at a hardcoded copy of .mi-illus's
// height, which is exactly the kind of duplicated constant that drifts.
// Every row carries every dot and they are all kept in sync by
// data-mi-dot index (see the scroll listener in showMoodIntro()), so what
// reads as one indicator is really one per page. aria-hidden because the
// slide position is decoration here, and three duplicated rows would
// otherwise be announced as a dozen empty elements.
function miDotsHtml(total, active) {
  return `<div class="mi-dots" aria-hidden="true">${
    Array.from({ length: total }, (_, i) =>
      `<span class="mi-dot${i === active ? ' on' : ''}" data-mi-dot="${i}"></span>`).join('')}</div>`;
}

function welcomeSlideHtml(s, i, total, active) {
  return `<div class="mi-slide" data-mi-index="${i}">
    <div class="mi-illus"><img src="${esc(cloudinaryUrl(welcomePhoto(s), 800))}" alt="" loading="eager"></div>
    ${miDotsHtml(total, active)}
    <div class="mi-copy">
      <div class="mi-title${s.titleLao ? ' lao' : ''}">${esc(s.title)}</div>
      <div class="mi-sub">${esc(s.sub)}</div>
    </div>
  </div>`;
}

// awaited from boot() before showMoodIntro() ever mounts, so none of the 3
// illustrations can pop in mid-swipe on a slow connection. Raced against a
// timeout rather than awaited unconditionally — same philosophy as the map
// load wait in boot() (see the MAPLIBRE HAZARD note there): past the cap the
// carousel opens anyway and a still-loading <img> just fills in on its own,
// because a slow image must not hold the splash hostage forever.
//
// Three images, not six: only the set the current theme will actually show.
// Preloading both sets would double the bytes of the very first screen for
// every visitor, to cover a theme change that essentially nobody makes
// during a 4-slide intro — and the splash is held on this. The carousel
// does handle that change if it happens (see the theme observer in
// showMoodIntro()); the other set just loads at that point, with a brief
// pop-in, which is the right side of that trade.
function preloadWelcomeSlides() {
  const loaders = WELCOME_SLIDES.map(s => new Promise(resolve => {
    const img = new Image();
    img.onload = img.onerror = resolve;
    img.src = cloudinaryUrl(welcomePhoto(s), 800);
  }));
  return Promise.race([
    Promise.all(loaders),
    new Promise(resolve => setTimeout(resolve, 4000)),
  ]);
}

const MOOD_INTRO_KEY = 'psd-mood-intro-seen';

// the half of shouldShowMoodIntro() that needs no network, so boot() can use
// it to decide whether the splash still has any reason to stay up. A "no"
// here is conclusive: the localStorage flag is written for everyone who
// dismisses the intro, signed in or not (see markMoodIntroSeen()), so a
// visitor carrying it can never be shown it again whatever /api/me says. A
// "yes" is only a maybe — shouldShowMoodIntro() still gets the final word
// once mePromise resolves.
function moodIntroPossible() {
  if (!anyVibeTagged()) return false;
  try { if (localStorage.getItem(MOOD_INTRO_KEY) === '1') return false; } catch (e) {}
  return true;
}

// gates the automatic first-open call in boot() to exactly once ever —
// mirrors users.intro_seen (migrations/004_intro_seen.sql) for the flame
// explainer, but with a localStorage fallback: most first-time visitors
// have no account yet, so there's no users row to check, and MOOD_INTRO_KEY
// is the only flag that can persist for them. Checked local-first so a
// visitor who dismissed it before signing in isn't shown it again just
// because the server flag hasn't caught up yet.
function shouldShowMoodIntro(me) {
  if (!anyVibeTagged()) return false;
  try { if (localStorage.getItem(MOOD_INTRO_KEY) === '1') return false; } catch (e) {}
  if (me?.ok && !me.signed_out && me.mood_intro_seen) return false;
  return true;
}

// best-effort, same philosophy as renderFlameIntro()'s "Got it" handler —
// an intro that reappears once (a failed POST) is milder than one that
// gets stuck. localStorage is written unconditionally, since it's what
// actually stops a repeat for the anonymous majority; the server call only
// changes anything for a signed-in visitor and 401s harmlessly for anyone
// else (see functions/api/mood-intro-seen.js).
function markMoodIntroSeen() {
  try { localStorage.setItem(MOOD_INTRO_KEY, '1'); } catch (e) {}
  fetch('/api/mood-intro-seen', { method: 'POST' }).catch(() => {});
}

// fire-and-forget log of one mood-chooser tap (migrations/015_mood_picks.sql,
// functions/api/mood-pick.js) — tag is the vibe key, or 'dismissed' for
// "Just show me around". Never awaited and never blocks opening the
// results: a failed log must not delay the thing the person actually
// tapped for.
function logMoodPick(tag) {
  fetch('/api/mood-pick', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag }),
  }).catch(() => {});
}

// full-screen intro flow — 3 welcome panels (WELCOME_SLIDES) followed by the
// "ຢາກໄປໃສດີ?" mood question as its 4th and last slide, a single horizontal
// swipe carousel (native scroll-snap, not a manual transform — see the
// .mi-viewport CSS comment for why). Shown automatically once, right as the
// splash fades (see boot(), which awaits preloadWelcomeSlides() first),
// gated by shouldShowMoodIntro(). Also reachable any time after via the
// quiet text link at the bottom of the Cafes list (see moodRelinkHtml()),
// which calls this same function with startAtMood:true — a manual reopen is
// someone who already knows what this is, so it jumps straight to the mood
// slide instead of replaying the 3 panels (still swipeable back to, just
// not shown by default).
//
// That 4th slide is itself two steps (see showStep() below): first which
// kind of place — Cafés or Bars, MOOD_TYPES — then the four moods within
// it, sliding in from the right with a back arrow that returns to step 1
// and never exits the intro. Both steps live inside the one slide, so the
// carousel still has exactly 4 pages and step 2 can't be swiped to before
// a type is chosen. Picking a mood marks the intro seen and opens the
// normal results popup (openVibePop()), same as a mood card anywhere else;
// picking a type with no moods yet marks it seen and opens that type's own
// list (openTypeList()); "Just show me around" (step 1's own link, or the
// "Skip" link visible on every slide) marks it seen and just closes,
// leaving whatever screen was already underneath (Home on first open, the
// Cafes tab on a manual reopen).
function showMoodIntro({ startAtMood = false } = {}) {
  const moodIndex = WELCOME_SLIDES.length; // last slide
  const startIndex = startAtMood ? moodIndex : 0;
  const totalSlides = moodIndex + 1;

  const ov = document.createElement('div');
  ov.className = 'mood-intro';
  ov.innerHTML = `
    <div class="mi-viewport" data-mi-viewport>
      ${WELCOME_SLIDES.map((s, i) => welcomeSlideHtml(s, i, totalSlides, startIndex)).join('')}
      <div class="mi-slide mi-slide-mood" data-mi-index="${moodIndex}">
        <div class="mood-intro-inner">
          <div class="mood-intro-brand" aria-hidden="true">${logoMark(20, 'var(--ink)')}<span class="mood-intro-brand-word">PAISAIDEE</span></div>
          <div class="ms-steps" data-ms-steps>
            <div class="ms-step on" data-ms-step="type">
              <div class="vibe-chooser">
                <div class="vibe-chooser-h">
                  <div class="vibe-chooser-title lao">ຢາກໄປໃສດີ?</div>
                  <div class="vibe-chooser-sub">Pick what you feel like.</div>
                </div>
                <div class="vibe-cards ms-type-cards">${MOOD_TYPES.map(typeCardHtml).join('')}</div>
                <button type="button" class="vibe-any" data-mood-intro-skip>Just show me around</button>
              </div>
            </div>
            <div class="ms-step" data-ms-step="mood">
              <div class="vibe-chooser">
                <div class="vibe-chooser-h ms-mood-h">
                  <button type="button" class="ms-back" data-ms-back aria-label="Back">‹</button>
                  <div>
                    <div class="vibe-chooser-title" data-ms-mood-title></div>
                    <div class="vibe-chooser-sub" data-ms-mood-sub></div>
                  </div>
                </div>
                <div class="vibe-cards" data-ms-mood-cards></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <button type="button" class="mi-skip" data-mi-skip>Skip</button>
    <div class="mi-controls">
      <button type="button" class="mi-next${startIndex === moodIndex ? ' mi-hidden' : ''}" data-mi-next aria-label="Next">›</button>
    </div>`;
  document.body.appendChild(ov);

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const viewport = ov.querySelector('[data-mi-viewport]');
  const dots = [...ov.querySelectorAll('.mi-dot')];
  const nextBtn = ov.querySelector('[data-mi-next]');
  const typeStep = ov.querySelector('[data-ms-step="type"]');
  const moodStep = ov.querySelector('[data-ms-step="mood"]');
  const typeCardsEl = typeStep.querySelector('.vibe-cards');
  const moodCardsEl = moodStep.querySelector('[data-ms-mood-cards]');
  const moodTitleEl = moodStep.querySelector('[data-ms-mood-title]');
  const moodSubEl = moodStep.querySelector('[data-ms-mood-sub]');

  // the mood slide's two steps live inside that one slide, stacked in a
  // single grid cell and swapped by class — NOT as a fifth .mi-slide. See
  // the .ms-steps comment in style.css for why (a fifth child of a
  // scroll-snap viewport is a page anyone can swipe to before choosing).
  // dir: 'forward' slides the incoming step in from the right, 'back' from
  // the left, null swaps silently (used when the slide scrolls out of view
  // and resets itself). Only a dir'd swap replays the card stagger; a
  // silent reset happens off-screen, and re-entry is the scroll listener's
  // job below.
  const activeCards = () => (moodStep.classList.contains('on') ? moodCardsEl : typeCardsEl);
  const showStep = (name, dir) => {
    const enter = name === 'mood' ? moodStep : typeStep;
    const leave = name === 'mood' ? typeStep : moodStep;
    leave.classList.remove('on', 'ms-from-right', 'ms-from-left');
    enter.classList.remove('ms-from-right', 'ms-from-left');
    enter.classList.add('on');
    if (dir) {
      restartAnim(enter, dir === 'back' ? 'ms-from-left' : 'ms-from-right');
      restartAnim(name === 'mood' ? moodCardsEl : typeCardsEl, 'mc-enter');
    }
  };

  // the cards' one-time entry animation (see .mc-enter in style.css) —
  // triggered here rather than unconditionally on mount, since on a fresh
  // open (startAtMood:false) the mood slide isn't the visible one yet; the
  // scroll listener below re-triggers it (restartAnim(), since adding a
  // class that's already present doesn't restart a CSS animation on its
  // own) each time the mood slide actually comes into view, swipe or
  // chevron alike — "on entry", not "only the very first time ever". Slide
  // 4 always opens on step 1, so it's the type cards that stagger in here;
  // step 2's own four cards get the same treatment when it's shown.
  let wasOnMood = startIndex === moodIndex;
  if (wasOnMood) typeCardsEl.classList.add('mc-enter');
  if (startIndex > 0) viewport.scrollLeft = startIndex * viewport.clientWidth;
  // scroll-snap does the paging itself (native touch handling — no manual
  // touchmove math, so there's no inline transform this needs to clean up
  // on touchcancel, unlike the drag-to-dismiss below in openVibePop()); this
  // listener keeps the dots AND the forward chevron (hidden once the mood
  // slide is reached — there's no "next" from the last slide) in sync with
  // wherever the scroll lands.
  let dotRaf = null;
  viewport.addEventListener('scroll', () => {
    if (dotRaf) return;
    dotRaf = requestAnimationFrame(() => {
      dotRaf = null;
      const idx = Math.round(viewport.scrollLeft / viewport.clientWidth);
      // every welcome panel carries its own full row (see miDotsHtml), so
      // this walks 3 rows x totalSlides dots and matches on the dot's own
      // page index — a positional `i === idx` would light up the wrong
      // dot in every row but the first
      dots.forEach(d => d.classList.toggle('on', Number(d.dataset.miDot) === idx));
      nextBtn.classList.toggle('mi-hidden', idx === moodIndex);
      const onMood = idx === moodIndex;
      if (onMood && !wasOnMood) restartAnim(activeCards(), 'mc-enter');
      // swiping back off the slide resets it to step 1: returning to a
      // half-finished two-step flow reads as broken, and it keeps "which
      // grid animates on re-entry" unambiguous. Silent (no dir) — this
      // happens with the slide already scrolled out of view.
      if (!onMood && wasOnMood) showStep('type', null);
      wasOnMood = onMood;
    });
  }, { passive: true });

  // the only forward affordance besides swiping itself
  nextBtn.addEventListener('click', () => {
    const idx = Math.round(viewport.scrollLeft / viewport.clientWidth);
    viewport.scrollTo({ left: (idx + 1) * viewport.clientWidth, behavior: reduced ? 'auto' : 'smooth' });
  });

  // .show/.hide run CSS *animations* (see the CSS), not transitions. A
  // transition needs the browser to snapshot the pre-change computed value
  // as its start point in one style pass, then diff it against the
  // post-change value in a later pass — if those two passes get coalesced
  // (a real risk right after an appendChild this heavy: 3 preloaded photos
  // + 4 more card images), the "before" snapshot can already be partway
  // to the "after" value, and the transition starts from there instead of
  // from true opacity:0 and gets stuck (observed, twice: 0.136, then 0.073
  // with the carousel added — a double rAF here to force the two passes
  // apart didn't survive the carousel making that recalc heavier still). A
  // fill-mode:forwards animation doesn't diff against a prior snapshot at
  // all — its 0% state is the element's own non-animated base style
  // (opacity:0 on .mood-intro), authoritative from the instant the
  // animation starts, so there's nothing an interrupted recalc can corrupt.
  // No rAF needed: adding the class synchronously is enough.
  ov.classList.add('show');

  // the illustrations come in a night set and a daytime set (WELCOME_SLIDES),
  // and only the current theme's three were preloaded — so if the theme
  // changes while the carousel is open, swap the <img> src and let the other
  // set load then. A brief pop-in on three images is the accepted cost of
  // not preloading six (see preloadWelcomeSlides()).
  //
  // Watches the data-theme attribute rather than hooking into applyTheme():
  // the theme moves on the toggle AND on the 60s interval that re-resolves
  // 'auto' at dusk (see bindTheme()), so reacting to the attribute itself
  // means no present or future path that sets it has to remember the intro
  // exists. Observer callbacks are delivered at the microtask checkpoint
  // after the setter's task finishes, so applyTheme() has always assigned
  // state.theme — which welcomePhoto() reads — by the time this runs.
  const themeObserver = new MutationObserver(() => {
    WELCOME_SLIDES.forEach((s, i) => {
      const img = ov.querySelector(`.mi-slide[data-mi-index="${i}"] .mi-illus img`);
      if (!img) return;
      const src = cloudinaryUrl(welcomePhoto(s), 800);
      if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    });
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  const dismiss = () => {
    // before the fade, not after: the overlay lingers ~280ms and the 60s
    // theme interval can fire inside that window, which would otherwise
    // swap all three illustrations out mid-fade
    themeObserver.disconnect();
    ov.classList.remove('show');
    ov.classList.add('hide');
    setTimeout(() => ov.remove(), reduced ? 0 : 280);
  };
  // step 2's grid is built for whichever type was picked, and pre-built at
  // mount for the first type that has one. Pre-building matters for
  // layout, not speed: both steps share one grid cell so the slide settles
  // to a single height (see .ms-steps), and an empty step 2 would let that
  // height — and so the vertically-centred brand mark and heading above it
  // — jump the first time somebody tapped a type.
  //
  // A type with moods gets the four mood cards; one without (MOOD_TYPES
  // moods:false — Bars today) gets the editorial lists instead, in the
  // .ms-type-cards layout step 1 already uses for its own two cards. Both
  // are the same .vibe-card shell and both open the same results popup, so
  // everything below this line is shared.
  let moodType = null;
  const fillMoodStep = (t) => {
    if (moodType === t.key) return;
    moodType = t.key;
    const lo = t.label_lo ? ` · <span class="lao">${esc(t.label_lo)}</span>` : '';
    moodTitleEl.innerHTML = `${esc(t.label)}${lo}`;
    moodSubEl.textContent = t.moods ? 'What kind of place?' : 'What are you after?';
    moodCardsEl.classList.toggle('ms-type-cards', !t.moods);
    moodCardsEl.innerHTML = t.moods
      ? VIBE_TAGS.map(tag => vibeCardHtml(tag, state.venues.filter(v => v.type === t.key))).join('')
      : typeListsFor(t.key).map(x => listCardHtml(x.def, x.venues)).join('');
    // bound here rather than once at mount: these cards don't exist until
    // this runs, and they're replaced wholesale whenever the type changes.
    // One binding for both kinds of card — the key is a vibe tag or a
    // TYPE_LISTS key, and openVibePop() resolves either.
    moodCardsEl.querySelectorAll('[data-vibe-tag], [data-list-key]').forEach(el => {
      const key = el.dataset.vibeTag || el.dataset.listKey;
      el.addEventListener('click', () => {
        // list keys are logged with a prefix, same convention as the type
        // step's `type:` above, so mood_stats can tell a list tap from a
        // mood tap without knowing today's vocabulary
        logMoodPick(el.dataset.listKey ? `list:${key}` : key);
        markMoodIntroSeen();
        dismiss();
        openVibePop(key, t.key);
      });
    });
  };

  // true when this type has a step 2 worth showing at all: four moods, or
  // at least one non-empty editorial list
  const hasStepTwo = (t) => t.moods || typeListsFor(t.key).length > 0;

  const pickType = (t) => {
    logMoodPick(`type:${t.key}`);
    if (!hasStepTwo(t)) {
      // no vibe vocabulary and nothing in either list — there is no second
      // step worth showing. Close the intro and hand the person that type's
      // own list instead of a screen of dead cards.
      markMoodIntroSeen();
      openTypeList(t.key);
      dismiss();
      return;
    }
    fillMoodStep(t);
    showStep('mood', 'forward');
  };

  // returns to step 1 and nothing else — the ways out of the intro itself
  // are Skip (the pill pinned to the top-right corner of the overlay, on
  // every slide including this one) and "Just show me around" on step 1,
  // both wired below
  ov.querySelector('[data-ms-back]').addEventListener('click', () => showStep('type', 'back'));
  typeCardsEl.querySelectorAll('[data-mood-type]').forEach(el => {
    const t = MOOD_TYPES.find(x => x.key === el.dataset.moodType);
    if (t) el.addEventListener('click', () => pickType(t));
  });
  const firstWithStepTwo = MOOD_TYPES.find(hasStepTwo);
  if (firstWithStepTwo) fillMoodStep(firstWithStepTwo);
  ov.querySelectorAll('[data-mood-intro-skip], [data-mi-skip]').forEach(el => el.addEventListener('click', () => {
    logMoodPick('dismissed');
    markMoodIntroSeen();
    dismiss();
  }));
}

// quiet route back to the mood chooser once it's been dismissed for good —
// plain text, not a card or button, deliberately easy to miss unless
// someone's looking for it
function moodRelinkHtml() {
  if (!anyVibeTagged()) return '';
  return `<button type="button" class="mood-relink lao" data-mood-relink>ຢາກໄປໃສດີ?</button>`;
}

// drops someone on the home list already filtered to one venue type — used
// by the intro's type step for a type that has no moods yet (see
// MOOD_TYPES). Clicks the real filter chip rather than re-implementing what
// tapping it does: bindChips() wires the static chips in index.html once at
// boot, so the chip is always present, and its handler already carries the
// whole behaviour (filter, markers, selection, route clearing, re-render,
// keeping the chip itself in view) with no second copy here to drift out of
// step. A MOOD_TYPES key with no matching chip is a no-op, which leaves
// whatever screen was underneath the intro — the same place "Just show me
// around" leaves you.
function openTypeList(type) {
  // chipBarEl, not document: on mobile All the bar is not in the page (the
  // category tiles replace it), and a document lookup would find nothing
  chipBarEl.querySelector(`.chip[data-filter="${type}"]`)?.click();
}

// { ov, sheetEl } while open, else null — a fresh overlay element created
// per open and fully removed on close (same lifecycle as openLightbox()/
// closeLightbox()), not a permanent hidden DOM node, so there's nothing
// left behind for elementFromPoint to snag on once ov.remove() has run.
let vibePop = null;
let vibePopObserver = null;

function vibePopKeydown(e) {
  if (e.key === 'Escape') closeVibePop();
}

function closeVibePop() {
  if (!vibePop) return;
  const { ov, sheetEl } = vibePop;
  document.removeEventListener('keydown', vibePopKeydown);
  vibePopObserver?.disconnect();
  vibePopObserver = null;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  ov.classList.remove('show');
  // hard reset regardless of how far a drag-to-dismiss got — touchcancel
  // included (wired below), so no inline transform can survive a close
  sheetEl.style.transition = '';
  sheetEl.style.transform = '';
  vibePop = null;
  setTimeout(() => ov.remove(), reduced ? 0 : 280);
}

// tagKey: one of VIBE_TAGS' keys, or a TYPE_LISTS key (the step-2 cards for
// a type with no moods — see typeListsFor()), or 'any' for that type's
// unfiltered list. One popup serves all three: a list brings its own
// ordering with it, a vibe tag filters the type's distance-sorted pool.
// type: the venue type the mood was chosen for (a MOOD_TYPES key) — defaults
// to 'cafe', which is what this popup meant before the chooser grew a type
// step in front of it, and what every caller outside that step still means.
function openVibePop(tagKey, type = 'cafe') {
  closeVibePop(); // guard against a stray double-open, same as openLightbox()
  const listDef = TYPE_LISTS.find(l => l.key === tagKey);
  const pool = sortForDisplay(state.venues.filter(v => v.type === type));
  const matches = listDef ? listDef.venues(type)
    : tagKey === 'any' ? pool
    : pool.filter(v => (v.vibe || []).includes(tagKey));
  const def = VIBE_TAGS.find(t => t.key === tagKey);
  const title = listDef ? listDef.label : def ? def.label : 'Anything';
  const titleLo = listDef ? listDef.label_lo : def ? def.label_lo : null;
  const titleHtml = `${esc(title)}${titleLo ? ` · <span class="lao">${esc(titleLo)}</span>` : ''}`;

  const ov = document.createElement('div');
  ov.className = 'vibe-pop';
  ov.innerHTML = `
    <div class="vibe-pop-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="vibe-pop-grip"></div>
      <div class="vibe-pop-head">
        <span class="vibe-pop-title">${titleHtml} <span class="vibe-pop-count">· ${matches.length}</span></span>
        <button type="button" class="vibe-pop-close" aria-label="Close">✕</button>
      </div>
      <div class="vibe-pop-body">
        ${matches.length
          ? matches.map(v => collageCardHtml(v)).join('')
          : `<div class="sec-empty">Nothing here right now.</div>`}
        <button type="button" class="vibe-pop-all" data-vibe-see-all>See all · <span class="lao">ເບິ່ງທັງໝົດ</span></button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const sheetEl = ov.querySelector('.vibe-pop-sheet');
  const bodyEl = ov.querySelector('.vibe-pop-body');
  vibePop = { ov, sheetEl };
  // double rAF — see showMoodIntro()'s comment; single rAF let this same
  // append+show sequence get stuck mid-transition
  requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add('show')));

  ov.addEventListener('click', (e) => { if (e.target === ov) closeVibePop(); });
  ov.querySelector('.vibe-pop-close').addEventListener('click', closeVibePop);
  // the way out of a narrowed set and into the whole type — closes the
  // popup, then the intro behind it if it is somehow still up, then clicks
  // the real type chip (openTypeList()). Present even on an empty result,
  // where it is the only thing left to do. The intro removal is a safety
  // net rather than the normal path: every caller today dismisses the intro
  // before opening this popup, but a popup that outlived it would leave a
  // full-screen overlay sitting on top of the list this just opened.
  ov.querySelector('[data-vibe-see-all]').addEventListener('click', () => {
    closeVibePop();
    document.querySelector('.mood-intro')?.remove();
    openTypeList(type);
  });
  // tapping a card closes the popup and opens that venue, same order as
  // every other [data-open-venue] tap elsewhere in the app expects
  bodyEl.querySelectorAll('[data-open-venue]').forEach(el =>
    el.addEventListener('click', () => { closeVibePop(); openVenue(el.dataset.openVenue); }));
  document.addEventListener('keydown', vibePopKeydown);

  // scoped to bodyEl, NOT #sheet — this popup lives outside #sheet entirely,
  // and an IntersectionObserver's root must be an ancestor of what it
  // observes or it never fires
  vibePopObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      vibePopObserver.unobserve(entry.target);
      const v = venueById(entry.target.dataset.openVenue);
      if (v) loadCollageCardPhotos(entry.target, v);
    }
  }, { root: bodyEl, rootMargin: '200px' });
  bodyEl.querySelectorAll('.collage-card').forEach(card => vibePopObserver.observe(card));

  // drag-to-dismiss from the grip only — the body scrolls its own card
  // list, so a swipe starting there must stay a scroll, not a close
  let dragStartY = null, dragDy = 0, dragging = false;
  const grip = ov.querySelector('.vibe-pop-grip');
  const dragReset = () => {
    dragging = false; dragDy = 0;
    sheetEl.style.transition = '';
    sheetEl.style.transform = '';
  };
  grip.addEventListener('touchstart', (e) => {
    dragStartY = e.touches[0].clientY; dragging = true;
    sheetEl.style.transition = 'none';
  }, { passive: true });
  grip.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    dragDy = Math.max(0, e.touches[0].clientY - dragStartY);
    sheetEl.style.transform = `translateY(${dragDy}px)`;
  }, { passive: true });
  grip.addEventListener('touchend', () => {
    if (!dragging) return;
    sheetEl.style.transition = '';
    if (dragDy > 70) closeVibePop();
    else sheetEl.style.transform = '';
    dragging = false; dragDy = 0;
  });
  // treated as a hard reset, not a settle — see CLAUDE.md's history of
  // stray inline transforms surviving an interrupted gesture in this app
  grip.addEventListener('touchcancel', dragReset);
}

// funnel for any "go to home" action that isn't an explicit back/close —
// a sticky routed venue (state.routeVenueId) wins over an incidental
// re-render, per clearRoute()'s comment on when a route is allowed to die
function goHome() {
  if (typeof edBlocksLeave === 'function' && edBlocksLeave(goHome)) return;
  // the lightbox is appended to document.body, not to #sheet, so re-rendering
  // the sheet underneath leaves it covering the fresh content (see
  // openLightbox()). closeLightbox() is a guarded no-op when nothing is open,
  // so it costs nothing on the paths that never had one. Deliberately here
  // and NOT by routing this function through leaveVenue(): the sticky-route
  // branch below re-opens a venue rather than leaving one, so goHome() is not
  // always a close and must not run leaveVenue()'s full teardown. Callers
  // reaching this: the map background tap (the post-check-in celebration
  // used to be one too; it opens You now) — see the same call in bindChips().
  closeLightbox();
  if (state.routeVenueId) { openVenue(state.routeVenueId); return; }
  renderHomeSheet();
}

// mobile Home only (see style.css's .surprise-btn) — CSS hides it on
// desktop. Bars/Cafes only: "surprise me" from every venue was too broad on
// All (the whole point of the other sections) and meaningless on Events (no
// venue-driven pick to make), so renderHomeSheet() only calls this from its
// f === 'bar' || 'cafe' branch now — All/Events render nothing here at all,
// not a hidden button. `filter` is always 'bar' or 'cafe' for that reason;
// quickSurpriseMe() below scopes its pick the same way.
/* ---------- Home / Discover (the All tab) ----------
   Built to screen 1 of Kar's design mockup: a photo hero carrying the
   brand, a search bar sitting on the hero's bottom edge, a row of round
   category buttons, then On fire as a carousel and "What's happening".
   What the mockup has that this does NOT build, and why, is in the report:
   star ratings and review counts (no reviews exist — ratingLineHtml()
   renders nothing until they do), "Trending" as a measured thing (no
   footfall data; the slot keeps its honest name, On fire, which is Kar's
   own picks), the heart / Saved (no saved-places feature), "More" (no
   further categories), and the search filter icon (no filters to open
   from here). The other tabs keep their list header and the chip row.

   The hero photo is the app's own first welcome illustration
   (WELCOME_SLIDES[0], the theme's variant), not the That Luang photo in the
   mockup, which is not an asset this project has. Swap the id here when
   Kar picks a real hero photo. */
function homeDiscoverHeaderHtml() {
  const slide = WELCOME_SLIDES[0];
  const photo = state.theme === 'light' ? slide.photoLight : slide.photoDark;
  const when = isNight() ? 'tonight' : 'today';
  return `
    <section class="home-hero" aria-label="Paisaidee">
      ${photo ? `<img class="home-hero-img" src="${esc(cloudinaryUrl(photo, 900))}" alt="" fetchpriority="high">` : ''}
      <div class="home-hero-scrim"></div>
      <div class="home-hero-text">
        <div class="home-hero-brand">${logoMark(18, '#131019')}<span>PAISAIDEE</span></div>
        <div class="home-hero-lo lao">ໄປໃສດີ</div>
        <div class="home-hero-en">Where should we go ${when}?</div>
      </div>
    </section>
    <label class="home-search" role="search">
      <span class="home-search-ico">${icoSearch(18)}</span>
      <input id="homeSearch" type="search" autocomplete="off" enterkeyhint="search"
        placeholder="Search places &amp; events" aria-label="Search places and events">
    </label>
    <div id="homeBody">
      ${homeCategoriesHtml()}
      <div class="s-subrow home-weather">${weatherWidgetHtml()}</div>`;
}

// round category buttons, one per filter the chip row offers — Bars, Cafes,
// Events today, Restaurants the moment its chip is visible (syncTypeChips()).
// A tap clicks that chip, so there is one filter path. These replace the
// photo tiles from the previous change, which came from the mockup's
// Explore screen (2), not Home (1). Neutral discs, not the mockup's four
// colours: coral stays the one accent, and it marks actions, not categories.
const CATEGORY_GLYPHS = {
  ...TILE_GLYPHS,
  event: '<rect x="4" y="5.5" width="16" height="14.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
};
function homeCategoriesHtml() {
  const keys = FILTER_ORDER.filter(k => k !== 'all' && !chipBarEl.querySelector(`.chip[data-filter="${k}"]`)?.hidden);
  const label = k => k === 'event'
    ? { lo: 'ອີເວັນ', en: 'Events' }
    : { lo: VENUE_TYPE_META[k].label_lo, en: VENUE_TYPE_META[k].label };
  return `<div class="home-cats">${keys.map(k => {
    const l = label(k);
    return `<button type="button" class="home-cat" data-cat="${k}">
        <span class="home-cat-disc"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${CATEGORY_GLYPHS[k] || CATEGORY_GLYPHS.venue}</svg></span>
        <span class="home-cat-lo lao">${esc(l.lo)}</span><span class="home-cat-en">${esc(l.en)}</span>
      </button>`;
  }).join('')}</div>`;
}

// On fire's carousel card, to the mockup's shape: photo on top, then name and
// one "Type · distance" line (the area when there is no fix). The line where
// the mockup prints stars is ratingLineHtml(), which prints nothing until
// Paisaidee has reviews of its own. No heart: there is no Saved feature.
function railCardHtml(v) {
  const photo = v.photos?.length ? v.photos[0] : null;
  const media = photo
    ? `<img class="big-thumb" src="${esc(cloudinaryUrl(photo, 600))}" alt="" loading="lazy">`
    : `<img class="big-thumb" src="${venueTileUri(v.short_name || v.name, v.type, true)}" alt="" loading="lazy">`;
  const d = distanceTo(v);
  const line = [VENUE_TYPE_META[v.type]?.one, d != null ? fmtDist(d) : v.area].filter(Boolean).map(esc).join(' · ');
  return `<div class="card rail-card${openStatus(v).open ? '' : ' closed'}" data-open-venue="${v.id}">
    ${photoWrap(media, v, true)}
    <div class="rail-card-body">
      <div class="rail-card-name">${esc(v.short_name || v.name)}</div>
      ${line ? `<div class="rail-card-sub">${line}</div>` : ''}
      ${ratingLineHtml(v)}
    </div>
  </div>`;
}

// one event row for "What's happening" (and search results): thumbnail,
// title, "Tonight · 8 pm" or the date, the venue, and a chevron only when
// there is a venue to open. Photo: the event's own, else its venue's lead,
// else the neutral placeholder. "unconfirmed" stays for an unverified event.
function eventRowHtml(ev) {
  const v = venueById(ev.venue_id);
  const photo = ev.photo || (v?.photos?.length ? v.photos[0] : null);
  const thumb = photo
    ? `<img class="thumb" src="${esc(cloudinaryUrl(photo, 300))}" alt="" loading="lazy">`
    : `<img class="thumb" src="${venueTileUri(ev.title, 'venue', false)}" alt="" loading="lazy">`;
  const date = eventDate(ev);
  const when = (date === todayISO() ? 'Tonight' : fmtDate(date)) + (ev.start_time ? ` · ${fmtTime(toMins(ev.start_time))}` : '');
  const where = v ? esc(v.short_name || v.name) : (ev.short ? esc(ev.short) : '');
  return `<div class="card row-card event-row${v ? '' : ' event-row-static'}"${v ? ` data-open-venue="${v.id}"` : ''}>
    <div class="photo-wrap">${thumb}</div>
    <div class="card-body">
      <span class="t-name">${esc(ev.title)}</span>
      <div class="t-sub">${esc(when)}${ev.verified ? '' : ' · unconfirmed'}</div>
      ${where ? `<div class="t-sub">${where}</div>` : ''}
    </div>
    ${v ? '<span class="event-row-chev" aria-hidden="true">›</span>' : ''}
  </div>`;
}

// search on the Discover header. Client-side over what the app already
// holds: venue names (English and Lao), short name, area, tagline and type;
// event titles (English and Lao), their line and venue. Every word typed
// must match, accents ignored. Results replace #homeBody until the box is
// cleared; the query survives a re-render of Home (a live data refresh, a
// location fix), though focus does not.
const searchNorm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function wireHomeSearch() {
  const input = document.getElementById('homeSearch');
  if (!input) return;
  input.value = state.homeQuery || '';
  const run = () => { state.homeQuery = input.value; renderHomeSearchResults(); };
  input.addEventListener('input', run);
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { input.value = ''; run(); }
    if (e.key === 'Enter') input.blur();
  });
  if (state.homeQuery) renderHomeSearchResults();
}
function renderHomeSearchResults() {
  const body = document.getElementById('homeBody');
  const box = document.getElementById('homeResults');
  if (!body || !box) return;
  const q = searchNorm(state.homeQuery).trim();
  if (!q) { box.hidden = true; box.innerHTML = ''; body.hidden = false; return; }
  const terms = q.split(/\s+/);
  const hit = parts => { const h = searchNorm(parts.join(' ')); return terms.every(t => h.includes(t)); };
  const venues = sortForDisplay(state.venues.filter(v => hit([
    v.name, v.short_name, v.name_lo, v.area, v.short, VENUE_TYPE_META[v.type]?.label, VENUE_TYPE_META[v.type]?.label_lo,
  ])));
  const events = state.events.filter(ev => hit([ev.title, ev.title_lo, ev.short, venueById(ev.venue_id)?.name]));
  const count = [venues.length && plural(venues.length, 'place', 'places'), events.length && plural(events.length, 'event', 'events')].filter(Boolean).join(' · ');
  box.innerHTML = (venues.length || events.length)
    ? `<div class="home-results-count">${count}</div>${venues.map(v => isMobile() ? rowCard(v) : plainListCardHtml(v)).join('')}${events.map(eventRowHtml).join('')}`
    : `<div class="sec-empty"><div class="sec-empty-ico" data-empty-svg></div>Nothing matches “${esc(state.homeQuery.trim())}”.</div>`;
  box.querySelectorAll('[data-open-venue]').forEach(el => el.addEventListener('click', () => openVenue(el.dataset.openVenue)));
  body.hidden = true;
  box.hidden = false;
  injectEmptyIcons();
}

/* ---------- type lists: distance filter ---------- */
// Any · 500m · 1km · 3km · 5km above the list on Bars / Cafes / Restaurants.
// Only drawn when there is a location fix — a distance filter with no
// position to measure from would be a row of dead buttons. It FILTERS the
// list and never re-sorts it: sortForDisplay() already orders by open-then-
// distance, and a filter that also reordered would move cards under a
// finger. While a distance is chosen, a venue with no confirmed location
// (pending) is hidden, since it cannot be shown to be within anything. The
// choice persists across the type tabs; it is ignored — not cleared — while
// there is no fix, and comes back when one arrives. The map's markers are
// not filtered: this is the list's filter, the map already shows distance.
const DISTANCE_FILTERS = [null, 500, 1000, 3000, 5000];
const distanceLabel = m => (m == null ? 'Any' : m < 1000 ? `${m}m` : `${m / 1000}km`);
const distanceFilterActive = () => state.distanceFilterM != null && !!state.userPos;
function withinDistance(v) {
  if (!distanceFilterActive()) return true;
  const d = distanceTo(v);
  return d != null && d <= state.distanceFilterM;
}
function distanceRowHtml() {
  if (!state.userPos) return '';
  return `<div class="dist-row" role="group" aria-label="Distance">${DISTANCE_FILTERS.map(m => {
    const on = state.distanceFilterM === m;
    return `<button type="button" class="dist-btn${on ? ' on' : ''}" data-dist="${m ?? ''}" aria-pressed="${on}">${distanceLabel(m)}</button>`;
  }).join('')}</div>`;
}
// the empty state for a type list. When a distance is what emptied it, say
// so and offer the one tap that undoes it, rather than the generic line —
// "Nothing here right now" would read as "there are no bars".
function typeListEmptyHtml() {
  const body = distanceFilterActive()
    ? `Nothing within ${distanceLabel(state.distanceFilterM)} of you. <button type="button" class="sec-empty-action" data-dist="">Show any distance</button>`
    : 'Nothing here right now — try another filter.';
  return `<div class="sec-empty"><div class="sec-empty-ico" data-empty-svg></div>${body}</div>`;
}

function surpriseMeHtml(filter) {
  // '<type>ໃດກໍໄດ້' is Kar's own pattern from the bar and café buttons.
  // TODO(lao): the restaurant one ('ຮ້ານອາຫານໃດກໍໄດ້') is that pattern
  // applied, not something Kar wrote — check it reads naturally.
  const label = `Surprise me · ${VENUE_TYPE_META[filter].label_lo}ໃດກໍໄດ້`;
  return `<button class="surprise-btn" data-surprise-me>
    ${icoSurprise(20)}<span class="surprise-label">${label}</span>
  </button>`;
}

/* Sleek item 24: On fire is a horizontal carousel on mobile again — ~262px
   cards with the next one peeking past the right edge (.fire-rail in
   style.css). Pass 2 of the mobile redesign had replaced that carousel with
   a vertical stack; that code is still the only other branch below, so
   flipping this one constant to false restores it exactly, with nothing to
   put back. Mobile only either way — desktop's On fire section is unchanged
   and never reads this. */
const ON_FIRE_CAROUSEL = true;

// see the All list at the bottom of renderHomeSheet()
const ALL_LIST_SKIPS_SHOWN = false;

function renderHomeSheet() {
  state.selectedId = null; if (state.map) updateSelection();
  setSheetView({ type: 'home', venueId: null });
  setMobileScreen('home');
  // does NOT clear the route — a route should only clear when the venue
  // sheet is explicitly closed (see the data-home handler below), a
  // different venue opens, or Directions is toggled off, never just because
  // the map was clicked or the sheet re-rendered for some other reason
  // every comparison here goes through eventDate(), never ev.date — for a
  // repeating event the two are different and only eventDate() is the night
  // being advertised. `today` is re-derived on every render (it always was),
  // so a tab held open across midnight re-sorts itself.
  const on = ev => eventDate(ev);
  const byTime = (a,b) => (on(a) === on(b))
    ? ((a.start_time || '99:99') < (b.start_time || '99:99') ? -1 : 1)
    : (on(a) < on(b) ? -1 : 1);
  const today = todayISO();
  const tonight = state.events.filter(ev => on(ev) === today).sort(byTime);
  const upcoming = state.events.filter(ev => on(ev) > today).sort(byTime);

  const f = state.filter || 'all';
  const matchType = v => f === 'all' || v.type === f;
    // 'event' filter shows no venue-driven sections; handled via showEvents/showVenueSections

  const late = state.venues.filter(v => opensLate(v) && matchType(v) && v.status !== 'opening-soon');
  // On fire / Busy spots are editorial (Kar's picks, state.picks.*) — a
  // pending venue (no confirmed location yet) is excluded even if it
  // somehow ended up in picks.json
  const notPending = v => v.pin_status !== 'pending';
  const pickVenues = (state.picks?.venue_ids || []).map(venueById).filter(Boolean).filter(matchType).filter(notPending);
  const busyVenues = (state.picks?.busy_venue_ids || []).map(venueById).filter(Boolean).filter(matchType).filter(notPending);
  const openingSoon = state.venues.filter(v => v.status === 'opening-soon' && matchType(v));

  const showEvents = (f === 'all' || f === 'event');
  const showVenueSections = (f !== 'event');

  /* Section headers are two lines on phone: the Lao label leads at 21px, the
     English sits beneath at 13px (see .sec-h in style.css). Every label
     passed in below has the shape "English · Lao", so the split happens here
     rather than at the eight call sites — one place that knows the shape.
     A label with no " · " (none today) keeps its single line rather than
     rendering an empty Lao line above it, and only gets the `lao` font class
     when the leading text is actually Lao.
     Took a `color` token name as its first argument until the accent pass:
     flame on On fire/Busy spots, violet on Tonight/Coming up/Opening soon,
     teal on Open late and on the Cafes list — four hues down one scroll, on
     a mark that is a bullet rather than a key (the section's name is right
     next to it). The dot is neutral in CSS now (see .sec-h .dot in
     style.css), so the parameter is gone rather than left in place ignored,
     which is how a colour argument quietly grows a caller again.
     An `icon` argument outranking the dot went the same way, and for the
     same reason. Its only caller was On fire, which passed miniFlame() — an
     18x22px render of a 72x88 drawing whose whole construction is a gold
     core path overlapping a coral outer path, so at that size the two
     collapse into one another and the detail turns to mush. The header says
     "On fire" in words; the flame was the only section mark in the app that
     differed from the rest, and a mark that differs is a mark that has to be
     read. Every header takes the same dot now. */
  const secH = (label, note) => {
    const [en, lo] = label.split(' · ');
    const lead = lo || en;
    const mark = `<span class="dot"></span>`;
    return `<div class="sec-h">`
      + `<span class="sec-h-lo${lo ? ' lao' : ''}">${mark}${lead}</span>`
      + (lo ? `<span class="sec-h-en">${en}</span>` : '')
      + (note ? `<span class="sec-note">${note}</span>` : '')
      + `</div>`;
  };

  // Lao only. Sleek item 10 had paired this with an English restatement
  // ("· Where shall we go tonight?"), which made it the longest line on the
  // screen and said nothing the headline directly above it hadn't already
  // established — dropped so the header reads as two lines plus weather
  // rather than four stacked full-width paragraphs. The `lao` font class
  // stays on the span rather than moving back onto the .s-sub wrapper: that
  // wrapper now shares a flex row with the weather widget (.s-subrow in
  // style.css), whose English label must not inherit Noto Sans Lao.
  const sub = isNight()
    ? '<span class="lao">ຄືນນີ້ໄປໃສດີ?</span>'
    : '<span class="lao">ມື້ນີ້ໄປໃສດີ?</span>';

  if (VENUE_TYPE_META[f]?.chip) {
    const label = `${VENUE_TYPE_META[f].label} · ${VENUE_TYPE_META[f].label_lo}`;
    let html = `
      ${greetEyebrowHtml()}
      <div class="s-title s-greet">${dayGreeting()}, Vientiane</div>
      <div class="s-subrow"><div class="s-sub">${sub}</div>${weatherWidgetHtml()}</div>
      ${surpriseMeHtml(f)}
      <div id="chipSentinel"></div>
      <div id="chipSlot"></div>`;
    html += secH(label);

    const cafeTab = state.cafeTab || 'recommended';
    if (f === 'cafe') {
      html += `
        <div class="seg" role="tablist">
          <button class="seg-btn ${cafeTab === 'recommended' ? 'on' : ''}" data-cafe-tab="recommended" role="tab" aria-selected="${cafeTab === 'recommended'}">Recommended</button>
          <button class="seg-btn ${cafeTab === 'all' ? 'on' : ''}" data-cafe-tab="all" role="tab" aria-selected="${cafeTab === 'all'}">All cafés</button>
        </div>`;
    }
    html += distanceRowHtml();

    if (f === 'cafe' && cafeTab === 'recommended') {
      // cafés with enough photos for a collage card to be worth showing —
      // pending venues excluded, same as On fire/Busy spots above
      const cafeGallery = sortForDisplay(state.venues
        .filter(v => v.type === 'cafe' && v.pin_status !== 'pending' && (v.photos?.length || 0) >= 2 && withinDistance(v))
        .sort((a, b) => (b.photos.length - a.photos.length) ||
          (a.short_name || a.name).localeCompare(b.short_name || b.name)));
      if (!cafeGallery.length) {
        html += typeListEmptyHtml();
      } else {
        html += cafeGallery.map(v => collageCardHtml(v)).join('');
      }
    } else {
      const typeVenues = sortForDisplay(state.venues.filter(v => v.type === f && withinDistance(v))
        .sort((a, b) => (a.short_name || a.name).localeCompare(b.short_name || b.name)));
      if (!typeVenues.length) {
        html += typeListEmptyHtml();
      } else if (isMobile()) {
        html += typeVenues.map(v => rowCard(v)).join('');
      } else {
        html += typeVenues.map(plainListCardHtml).join('');
      }
    }
    if (f === 'cafe') html += moodRelinkHtml();
    setSheet(html);
    injectEmptyIcons();
    observeCollageCards();
    history.replaceState(null, '', location.pathname);
    const sh = document.getElementById('sheet');
    sh.classList.remove('sheet-anim'); void sh.offsetWidth; sh.classList.add('sheet-anim');
    return;
  }

  // All is the Discover screen (homeDiscoverHeaderHtml()); Events, the other
  // filter this branch draws, keeps the list header and the chip row, since
  // the chip row is the way back
  let html = f === 'all' ? homeDiscoverHeaderHtml() : `
    ${greetEyebrowHtml()}
    <div class="s-title s-greet">${dayGreeting()}, Vientiane</div>
    <div class="s-subrow"><div class="s-sub">${sub}</div>${weatherWidgetHtml()}</div>
    <div id="chipSentinel"></div>
    <div id="chipSlot"></div>`;
  let rendered = false;
  const mobile = isMobile();
  // horizontal-scroll carousel (desktop, unchanged) vs. a vertical list of
  // row cards (mobile Pass 2) — every non-hero section below picks between
  // these the same way
  const sectionWrap = cardsHtml => mobile ? cardsHtml : `<div class="hcards">${cardsHtml}</div>`;

  if (f === 'event' && tonight.length) {
    rendered = true;
    html += secH('Tonight · ຄືນນີ້');
    for (const ev of tonight) {
      const v = venueById(ev.venue_id);
      const evLine = `${ev.start_time ? fmtTime(toMins(ev.start_time)) + ' · ' : ''}${fmtPrice(ev.price)}`;
      if (!v) {
        const media = ev.photo
          ? `<img class="big-thumb" src="${esc(cloudinaryUrl(ev.photo, 900))}" alt="" loading="lazy">`
          : `<img class="big-thumb" src="${venueTileUri(ev.title, 'venue', true)}" alt="" loading="lazy">`;
        html += `
          <div class="card card-big">
            ${media}
            <div class="card-body">
              <div class="cb-name">${esc(ev.title)}</div>
              <div class="t-sub">${evLine}${ev.short ? ' · ' + esc(ev.short) : ''}${ev.verified ? '' : ' · unconfirmed'}</div>
            </div>
          </div>`;
        continue;
      }
      const tonightPhoto = ev.photo || ((v.photos && v.photos.length) ? v.photos[0] : null);
      const media = tonightPhoto
        ? `<img class="big-thumb" src="${esc(cloudinaryUrl(tonightPhoto, 900))}" alt="" loading="lazy">`
        : `<img class="big-thumb" src="${venueTileUri(v.short_name || v.name, 'venue', true)}" alt="" loading="lazy">`;
      // status+distance is already folded into this sub-line via venueLine()
      // (falls back to the area name with no location) — every card here
      // already had it before Pass 2, nothing to add. This card previously
      // had no .closed dimming or status pill at all — item 3 asked for
      // the same open/closed treatment everywhere a venue appears, and a
      // Tonight event is still tied to a real venue with its own hours.
      html += `
        <div class="card card-big${openStatus(v).open ? '' : ' closed'}" data-open-venue="${v.id}">
          ${photoWrap(media, v, true)}
          <div class="card-body">
            <div class="cb-name">${esc(ev.title)} — ${esc(v.short_name || v.name)}</div>
            <div class="t-sub">${evLine} · ${venueLine(v, esc(v.area || ''))}${ev.verified ? '' : ' · unconfirmed'}</div>
          </div>
        </div>`;
    }
  }

  if (f === 'event' && !tonight.length && !upcoming.length) {
    rendered = true;
    /* two different facts, two different sentences. "Nothing verified yet"
       is a statement about the week's curation and is only true when
       data/events.json actually loaded and had nothing current in it. When
       the file could not be read, state.events is [] for a completely
       different reason, and printing the curation line there tells someone
       there is nothing on tonight when we simply do not know. */
    html += secH('Tonight · ຄືນນີ້') +
      (state.eventsFailed
        ? `<div class="sec-empty"><div class="sec-empty-ico" data-empty-svg></div>Couldn't load what's on — check your connection and reload. The venues below still work.</div>`
        : `<div class="sec-empty"><div class="sec-empty-ico" data-empty-svg></div>Nothing verified yet — new list every Thursday.</div>`);
  }

  const pickVenuesQ = sortEditorial(pickVenues);
  if (showVenueSections && pickVenuesQ.length) {
    rendered = true;
    const railed = mobile && ON_FIRE_CAROUSEL;
    const fireCards = pickVenuesQ.map(v => railed ? railCardHtml(v) : bigCard(v, venueLine(v, esc(v.area || '')))).join('');
    html += secH('On fire · ໄຟລຸກ', esc(state.picks?.note_en)) +
      (railed ? `<div class="fire-rail">${fireCards}</div>` : fireCards) +
      `<div style="font-size:10.5px;color:var(--secondary);margin-top:8px;">picked by us, not ranked by check-ins</div>`;
  }

  /* What's happening — the mockup's second section, on All only: the
     soonest few events (tonight first) as rows, and See all to the Events
     tab, which keeps the fuller Tonight / Coming up layout. Lao is ອີເວັນ,
     the Events chip's own word, not a new phrase. The two empty states are
     the ones the Tonight section already had, for the same two reasons. */
  if (f === 'all') {
    const HAPPENING_MAX = 3;
    const happening = [...tonight, ...upcoming];
    rendered = true;
    const seeAll = happening.length ? '<button type="button" class="sec-see-all" data-see-all="event">See all</button>' : '';
    html += secH("What's happening · ອີເວັນ", seeAll) + (happening.length
      ? happening.slice(0, HAPPENING_MAX).map(eventRowHtml).join('')
      : state.eventsFailed
        ? `<div class="sec-empty"><div class="sec-empty-ico" data-empty-svg></div>Couldn't load what's on — check your connection and reload. The venues below still work.</div>`
        : `<div class="sec-empty"><div class="sec-empty-ico" data-empty-svg></div>Nothing verified yet — new list every Thursday.</div>`);
  }

  const busyVenuesQ = sortEditorial(busyVenues);
  if (showVenueSections && busyVenuesQ.length) {
    rendered = true;
    html += secH('Busy spots · ບ່ອນຄົນຫຼາຍ', esc(state.picks?.busy_note_en)) +
      sectionWrap(busyVenuesQ.map(v => mobile ? rowCard(v) : sectionCard(v, venueLine(v, esc(v.area || '')))).join('')) +
      `<div style="font-size:10.5px;color:var(--secondary);margin-top:8px;">our picks, not live counts</div>`;
  }

  if (f === 'event' && upcoming.length) {
    rendered = true;
    html += secH('Coming up · ອີເວັນຕໍ່ໄປ') + sectionWrap(upcoming.map(ev => {
      const v = venueById(ev.venue_id);
      const evSub = `${fmtDate(eventDate(ev))} · ${esc(ev.title)}`;
      if (!v) {
        return mobile
          // .row-card + .photo-wrap so an event with no pinned venue sits in
          // the same list as rowCard()'s venues instead of being the one
          // card left with an inset thumbnail once Sleek item 30 made the
          // rest flush. No .photo-wrap status pill: there is no venue here
          // to have hours, which is the whole reason this branch exists.
          ? `<div class="card row-card"><div class="photo-wrap"><img class="thumb" src="${venueTileUri(ev.title, 'venue', false)}" alt="" loading="lazy"></div>
              <div class="card-body"><span class="t-name">${esc(ev.title)}</span>
              <div class="t-sub">${fmtDate(eventDate(ev))}${ev.short ? ' · ' + esc(ev.short) : ''}</div></div></div>`
          : `<div class="hcard">
            ${ev.photo ? `<img class="thumb" src="${esc(cloudinaryUrl(ev.photo, 200))}" alt="" loading="lazy">` : `<img class="thumb" src="${venueTileUri(ev.title, 'venue', false)}" alt="" loading="lazy">`}
            <div>
              <div style="font-size:12.5px;font-weight:700;">${esc(ev.title)}</div>
              <div class="hc-sub" style="font-size:11px;color:var(--mute);">${fmtDate(eventDate(ev))}${ev.short ? ' · ' + esc(ev.short) : ''}</div>
            </div>
          </div>`;
      }
      return mobile ? rowCard(v, evSub) : sectionCard(v, evSub, ev.photo, venueLine(v, ''));
    }).join(''));
  }

  const openingSoonQ = sortForDisplay(openingSoon);
  if (showVenueSections && openingSoonQ.length) {
    rendered = true;
    html += secH('Opening soon · ກຳລັງຈະເປີດ') +
      sectionWrap(openingSoonQ.map(v => mobile ? rowCard(v) : sectionCard(v, venueLine(v, esc(v.area || '')))).join(''));
  }

  const lateQ = sortForDisplay(late);
  if (showVenueSections && lateQ.length) {
    rendered = true;
    html += secH('Open late · ເປີດເດິກ') +
      sectionWrap(lateQ.map(v => mobile ? rowCard(v) : sectionCard(v, venueLine(v, openStatus(v).label))).join(''));
  }

  /* Every venue, beneath the editorial sections. All used to be ONLY those
     sections (Kar's picks, busy spots, what's on, opening soon, open late),
     so a venue that was none of them — 17 of the 30 on 2026-09-15 — could
     only be found by changing the filter, and nothing on All said the
     list was partial. Sorted exactly the way the type lists sort: by name,
     then sortForDisplay() — open first, nearest first when location is
     known, closed sinking. Same cards as the type lists too (rowCard() on
     a phone, plainListCardHtml() on desktop), vertical on both: 30 cards in
     desktop's side-scroll carousel would hide the list all over again.
     Pending venues are in it, as they are in the type lists (CLAUDE.md).
     The count in the header is a plain count, not a popularity figure.
     ALL_LIST_SKIPS_SHOWN: false lists every venue, so one already in a
     section above appears twice — the list is predictable (everything,
     once each, in one order) at the cost of repeats. true lists only the
     venues not already on screen. Kar's call; see autonomous-run.md. */
  if (f === 'all' && state.venues.length) {
    const shownAbove = new Set([
      ...pickVenuesQ, ...busyVenuesQ, ...openingSoonQ, ...lateQ,
      ...tonight.map(ev => venueById(ev.venue_id)), ...upcoming.map(ev => venueById(ev.venue_id)),
    ].filter(Boolean).map(v => v.id));
    const everyVenue = sortForDisplay(state.venues
      .filter(v => !ALL_LIST_SKIPS_SHOWN || !shownAbove.has(v.id))
      .sort((a, b) => (a.short_name || a.name).localeCompare(b.short_name || b.name)));
    if (everyVenue.length) {
      rendered = true;
      html += secH('All places · ທັງໝົດ', plural(everyVenue.length, 'place', 'places')) +
        (mobile ? everyVenue.map(v => rowCard(v)).join('') : everyVenue.map(plainListCardHtml).join(''));
    }
  }


  if (!rendered) {
    html += `<div class="sec-empty"><div class="sec-empty-ico" data-empty-svg></div>Nothing here right now — try another filter.</div>`;
  }

  if (f === 'all') html += `</div><div id="homeResults" class="home-results" hidden></div>`;
  html += weatherAttributionHtml();
  setSheet(html);
  injectEmptyIcons();
  if (f === 'all') wireHomeSearch();
  history.replaceState(null, '', location.pathname);
  const sh = document.getElementById('sheet');
  sh.classList.remove('sheet-anim'); void sh.offsetWidth; sh.classList.add('sheet-anim');
}

/* re-labels the check-in button from current state.userPos — must be called
   after ANY change to state.userPos while a venue sheet is open (not just
   inside openVenue()), or the button goes stale even though other
   userPos-dependent features (like Directions) read live state and work fine */
function updateCheckinButton(v) {
  const cbtn = document.getElementById('checkinBtn');
  const lbl = document.getElementById('checkinLabel');
  if (!cbtn || !lbl) return;
  cbtn.disabled = true;
  cbtn.classList.remove('ready');
  if (!state.userPos) {
    // same six-value set as LOCATE_LABELS — see requestLocation(). The last
    // branch is the no-error case ("we have not asked yet"), so anything
    // that IS an error has to be named above it: 'failed' used to land there
    // and told someone to enable a permission they had already granted, and
    // 'unsupported' told them to enable one that does not exist here.
    lbl.textContent =
        state.geoError === 'blocked'     ? 'Location blocked'
      : state.geoError === 'unsupported' ? 'Location not available here'
      : (state.geoError === 'timeout' || state.geoError === 'unavailable'
         || state.geoError === 'failed') ? "Can't find you"
      : 'Enable location to check in';
  } else {
    /* the radius is the SERVER's (state.checkinRadiusM, from /api/venues —
       see functions/api/_checkin-config.js). This was a hardcoded 150 that
       had to agree with a D1 config row by hand. Not known yet (booted off
       the bundled mirror, live response not in): the button is offered
       without claiming "you're here", and the server decides — a too_far
       reply also teaches us its radius (see doCheckin()). */
    const d = haversine(state.userPos, v);
    const radius = state.checkinRadiusM;
    if (radius == null || d <= radius) {
      cbtn.disabled = false;
      cbtn.classList.add('ready');
      lbl.textContent = radius == null ? 'Check in' : "You're here — check in";
    } else {
      lbl.textContent = `${fmtDist(d)} away — get closer`;
    }
  }
  // there is exactly one primary action on the page, and it is never a
  // disabled one: when check-in isn't available (too far, no fix, blocked)
  // the flame fill moves to Directions, which always works from here.
  // Both classes are set on both buttons every time — toggling only the
  // primary would leave whichever button lost it wearing neither.
  const ready = cbtn.classList.contains('ready');
  cbtn.classList.toggle('vd-btn-primary', ready);
  cbtn.classList.toggle('vd-btn-secondary', !ready);
  const dbtn = document.getElementById('dirBtn');
  if (dbtn) {
    dbtn.classList.toggle('vd-btn-primary', !ready);
    dbtn.classList.toggle('vd-btn-secondary', ready);
  }
}

/* ---------- sheet: venue detail ---------- */
function openVenue(id) {
  // a map pin is tappable on desktop while an owner form is open
  if (typeof edBlocksLeave === 'function' && edBlocksLeave(() => openVenue(id))) return;
  const v = venueById(id);
  if (!v) return;
  // mobile back-button support (see leaveVenue()/the popstate listener):
  // only a genuinely fresh open — not a re-render of the venue already
  // showing, e.g. the sticky reopen from goHome() — records where "back"
  // should return to and pushes a history entry for it
  const isFreshOpen = state.sheetView.type !== 'venue';
  if (isFreshOpen) state.screenBeforeVenue = state.screen;
  toggleSheet(false);
  if (!state.userPos) warmLocation();  // so Directions usually has a fix already — see warmLocation()
  // a route only dies when a DIFFERENT venue opens — reopening the routed
  // venue itself (e.g. sticky re-open from goHome()) must keep it (see #4)
  if (state.routeVenueId && state.routeVenueId !== id) clearRoute();
  const hasStickyRoute = state.routeVenueId === id && !!state.currentRouteGeometry;
  state.selectedId = id; updateSelection();
  setSheetView({ type: 'venue', venueId: id });
  const st = openStatus(v);
  const evs = venueEvents(id);
  // owner-submitted venue awaiting Kar's pin (migrations/009_pin_status.sql)
  // — no confirmed lat/lng, so no check-in, no Directions, no distance
  const isPending = v.pin_status === 'pending';

  const photos = v.photos || [];
  // full-bleed photo collage (see .vd-hero in style.css), replacing the single
  // hero image: 1 photo fills the block, 2 split it large-left/tall-right, 3
  // stacks two tiles beside the large one, and a 4th+ photo folds into a "+N"
  // on the last tile. That "+N" is exactly what the old .vd-photo-count badge
  // said, so the badge is gone rather than saying it twice.
  //
  // collagePhotosHtml() is the SAME component the Recommended café list and
  // the mood popup use, markup and loader included — nothing here is a second
  // copy of it. The one thing scoped to this page is its axis: .vd-hero is a
  // wide, short box, so style.css re-lays the same markup out left/right
  // instead of the card's top/bottom (see .vd-hero .collage-photos there).
  // It renders inside .vd-hero's existing box at its existing height, so the
  // title block below does not move down.
  //
  // statusPillHtml() returns '' when v.hours is null — no invented "unknown"
  // pill (see CLAUDE.md). The back arrow and the pill share the top-left
  // cluster as one flex row rather than stacking on top of each other.
  const heroHtml = `
    <div class="vd-hero${photos.length ? ' vd-hero-tap' : ''}">
      ${collagePhotosHtml(v, v.name)}
      <div class="vd-hero-tl">
        <button class="vd-round" data-home aria-label="Back">${icoBack(17)}</button>
        ${statusPillHtml(v, true)}
      </div>
      <div class="vd-hero-tr">
        ${isNo1(v) ? '<span class="vd-tonight">TONIGHT</span>' : ''}
        <button class="vd-round" data-home aria-label="Close">✕</button>
      </div>
    </div>`;

  let travel;
  if (isPending) {
    travel = 'Location being confirmed';
  } else if (hasStickyRoute) {
    travel = state.routeLabel;
  } else if (state.userPos) {
    travel = `${fmtDist(haversine(state.userPos, v))} away`;
  } else if (state.geoError === 'unsupported') {
    // nothing to tap and nothing to turn on — do not send someone to a
    // control that cannot help them
    travel = `<span class="vd-dim">distance unavailable here</span>`;
  } else if (state.geoError === 'blocked') {
    // "tap near me" is still the right next step (the pill explains how to
    // unblock), but it must not pretend the tap will produce a distance
    travel = `<span class="vd-dim">location off — tap "near me" to fix</span>`;
  } else {
    travel = `<span class="vd-dim">tap "near me" for distance</span>`;
  }

  const order = ['mon','tue','wed','thu','fri','sat','sun'];
  const todayKey = DAYS[new Date().getDay()];
  const week = !v.hours
    ? '<div>hours not yet confirmed</div>'
    : order.map(d => {
    const h = parseHours(v.hours[d]);
    const label = h ? `${fmtTime(h.open)} – ${fmtTime(h.close % 1440)}` : 'closed';
    return `<div class="${d === todayKey ? 'today' : ''}"><span>${d}</span><span>${label}</span></div>`;
  }).join('');

  // tagline · distance on one line — distance decides whether someone goes,
  // so it sits with the name instead of in a row below the fold. #travelLine
  // stays the element toggleRoute() rewrites with the routed distance/time.
  const metaBits = [];
  if (v.short) metaBits.push(esc(v.short));
  metaBits.push(`<span id="travelLine">${travel}</span>`);

  // the venue's own vibe tags (migrations/013_vibe.sql), which until now only
  // showed inside the mood chooser. Unknown keys are dropped rather than
  // printed raw; no row at all when the venue has none.
  const vibes = (v.vibe || []).map(k => VIBE_TAGS.find(t => t.key === k)).filter(Boolean);

  // one primary action only. Check in is the primary when it's actually
  // available; updateCheckinButton() moves the flame fill to Directions the
  // moment it isn't, so a disabled button never wears the primary styling.
  // A pending venue has no confirmed lat/lng — nothing to check into and
  // nothing to route to — so neither button renders and Share is all that's
  // left; it takes the row as a labelled secondary rather than a lone icon.
  const actionsHtml = isPending
    ? `<div class="vd-actions">
        <button class="vd-btn vd-btn-secondary" id="shareBtn">${icoShare(16)}<span>Share</span></button>
      </div>`
    : `<div class="vd-actions">
        <button class="vd-btn vd-btn-secondary" id="checkinBtn" data-venue="${v.id}" disabled>
          <span id="checkinLabel">Check in</span>
        </button>
        <button class="vd-btn vd-btn-secondary" id="dirBtn"><span id="dirLbl">Directions</span></button>
        <button class="vd-btn vd-btn-icon" id="shareBtn" aria-label="Share">${icoShare(16)}</button>
      </div>`;

  /* "Why you'll like it" (migrations/017_why_rating.sql): Kar's short
     editorial paragraph on who the place suits, above the owner-written
     description. Skipped ENTIRELY when `why` is absent — no heading, no
     placeholder — which is every venue on the day this ships, so the sheet
     reads exactly as it did before. Shown in full, not truncated behind
     "More" like the description: it is short by design and is the reason to
     read on.
     TODO(lao): "ເປັນຫຍັງຄວນໄປ" is the heading as given in the task, not yet
     checked by a native speaker. */
  const whyHtml = (typeof v.why === 'string' && v.why.trim()) ? `
    <div class="vd-why">
      <div class="vd-why-h"><span class="lao">ເປັນຫຍັງຄວນໄປ</span> · Why you'll like it</div>
      <p class="vd-why-body">${esc(v.why.trim())}</p>
    </div>` : '';

  const [descFirst, descRest] = firstSentence(v.description || '');
  const descHtml = !descFirst ? '' : `
    <div class="vd-desc" id="vdDesc">
      <span>${esc(descFirst)}</span>${descRest ? `<span class="vd-desc-rest"> ${esc(descRest)}</span>
      <button type="button" class="vd-more" id="descMore">More</button>` : ''}
    </div>`;

  // ---- the factual group: one divider above it, each row now its own card
  // 16px from the next (see .vd-row in style.css), 20px stroke icons in a
  // tinted disc (never emoji — same reason the header lost its own)
  const detail = [];
  if (v.area) detail.push(vdRow(icoPin(20), esc(v.area)));
  detail.push(vdRow(icoClock(20), `
    <span class="vd-status">${esc(st.label)}</span>
    <span class="vd-dot">·</span>
    <button type="button" class="vd-more" id="hoursToggle">all hours</button>
    <div class="hours-week" id="hoursWeek">${week}</div>`));
  /* open-air. The card note (outdoorNoteHtml()) only speaks when rain is
     actually a factor, which is right for a scan surface — but the sheet is
     where someone decides to go, and "this place has no roof" is worth
     knowing before you set off whether or not it happens to be raining as
     you read it. So this row is unconditional on the weather and the
     sub-line is what changes.
     Strictly `=== true`, never truthiness: outdoor is a THREE-state field
     (CLAUDE.md) and absent means nobody has audited the venue, which must
     not render as "indoors". outdoor: false renders nothing here either —
     that is a real audited fact, but "this place is indoors" is new
     editorial surface, and adding it is Kar's call rather than a side
     effect of adding the open-air row that was asked for.
     TODO(lao): "ກາງແຈ້ງ" below is my attempt at "open-air / outdoors" and
     has NOT been checked by a native speaker. It is in the same state as the
     WEATHER_LABELS_LO map further up — see the TODO(lao) note there. */
  if (v.outdoor === true) {
    const rain = rainState();
    // softened with the widget — see weatherWidgetHtml(). Was 'raining now
    // — it may be shut' / 'rain likely tonight — it may shut'.
    const sub = rain === 'now'   ? 'rain around — it may be shut'
              : rain === 'likely' ? 'rain around later — it may shut'
              : 'no cover if the weather turns';
    detail.push(vdRow(icoPartlyCloudy(20), `
      <div class="vd-row-label">Open-air · <span class="lao">ກາງແຈ້ງ</span></div>
      <div class="vd-row-sub">${esc(sub)}</div>`));
  }
  if (v.parking?.note) detail.push(vdRow(icoParking(20), esc(v.parking.note)));
  if (v.contact?.phone) detail.push(vdRow(icoPhone(20), `
    <a href="tel:${esc(v.contact.phone)}" class="vd-phone">${esc(v.contact.phone_display || v.contact.phone)}</a>
    <div class="vd-row-sub">call to book a table</div>`));
  const links = [];
  // the old fourth action button folded in here — Maps is a link, not an
  // action that should compete with Check in for the eye
  if (v.links?.maps) links.push(`<a id="vdMapsLink" href="${esc(v.links.maps)}" target="_blank" rel="noopener">Google Maps</a>`);
  if (v.links?.facebook) links.push(`<a href="${esc(v.links.facebook)}" target="_blank" rel="noopener">Facebook page</a>`);
  if (v.links?.website) links.push(`<a href="${esc(v.links.website)}" target="_blank" rel="noopener">Website</a>`);
  if (links.length) detail.push(vdRow(icoLink(20), `<div class="vd-links">${links.join('')}</div>`));
  if (v.signature?.length) detail.push(vdRow(icoSpoon(20), `
    <div class="vd-row-label">Try this · <span class="lao">ລອງອັນນີ້</span></div>
    <div class="v-sig-list">
      ${v.signature.map(it => `
        <div class="v-sig-item">
          <div class="v-sig-name">${esc(it.name)}</div>
          ${(it.price != null || it.note) ? `<div class="v-sig-meta">${it.price != null ? fmtKip(it.price) : ''}${it.price != null && it.note ? ' · ' : ''}${it.note ? esc(it.note) : ''}</div>` : ''}
        </div>`).join('')}
    </div>`));

  let html = `
    <span data-venue-detail hidden></span>
    ${heroHtml}
    <div class="vd-title">${v.name_lo ? `<span class="vd-title-lo lao">${esc(v.name_lo)}</span><span class="vd-title-sep"> · </span>` : ''}${esc(v.name)}</div>
    <div class="vd-meta">${metaBits.join(' <span class="vd-dot">·</span> ')}</div>
    ${ratingLineHtml(v, 'vd-rating')}
    ${vibes.length ? `<div class="vd-vibes">${vibes.map(t => `<span class="vd-vibe">${esc(t.label)}</span>`).join('')}</div>` : ''}
    ${actionsHtml}
    ${whyHtml}
    ${descHtml}`;

  for (const ev of evs) {
    html += `
      <div class="card" style="cursor:default;">
        <span class="tag">${eventDate(ev) === todayISO() ? 'TONIGHT' : fmtDate(eventDate(ev))}</span>
        <div style="font-size:13px;font-weight:700;margin-top:3px;">${esc(ev.title)}</div>
        <div class="t-sub">${ev.start_time ? fmtTime(toMins(ev.start_time)) + ' · ' : ''}${fmtPrice(ev.price)}${ev.verified ? '' : ' · unconfirmed'}</div>
      </div>`;
  }

  html += `
    <div class="vd-details">${detail.join('')}</div>
    <div class="section-h">Comments</div>
    <div class="comment-empty">
      No comments yet.<br>
      Comments aren't open yet — they're coming.
    </div>
    ${v.verified ? '' : '<div class="hint">details unconfirmed — hours may differ</div>'}
    <div id="routeAttribution"></div>`;

  setSheet(html);
  // must run after setSheet() has put the new content in the DOM, or the
  // still-rendering old content's scrollTop assignment gets overwritten
  const sheet = document.getElementById('sheet');
  if (sheet) sheet.scrollTop = 0;
  // mobile back-button support: a fresh open pushes a history entry so the
  // hardware/browser back button can pop it and close the venue (see the
  // popstate listener in boot()) — except on a deep link (?v=id) load, where
  // that URL is already the current entry and pushing would just add a
  // second, identical one. A re-render of an already-open venue (sticky
  // reopen, content refresh) reuses the existing entry either way.
  const venueUrl = '?v=' + v.id;
  if (isFreshOpen && isMobile() && location.search !== venueUrl) {
    history.pushState({ psdVenue: id }, '', venueUrl);
    state.venuePushed = true;
  } else {
    history.replaceState(null, '', venueUrl);
  }
  // the collage's tiles start on the venue monogram with their real photo URL
  // parked in data-src (see collagePhotosHtml()). Every other user of that
  // component waits for an IntersectionObserver to say the card is nearly
  // visible; this one IS the top of the page the user just opened, so it
  // loads immediately instead. loadCollageCardPhotos() also arms the per-tile
  // load/error/6s-timeout monogram fallback (watchCollageCard()), which is
  // what the single watchImgLoad() on the old #galHero used to do.
  const heroEl = document.querySelector('.vd-hero');
  if (heroEl) loadCollageCardPhotos(heroEl, v);
  // one delegated handler on the collage rather than one per tile: each tile
  // opens the lightbox at ITS OWN photo, not at 0. Tile order in the DOM is
  // the component's documented order (big tile = photos[0], then the row's
  // tiles in order), so a tile's position among .collage-tile IS its photo
  // index. On a 4+ collage the last tile carries the "+N" and opens at
  // photos[2]; the lightbox's own prev/next walks the rest from there. A
  // venue with no photos renders the monogram tile, which has nothing to
  // open, so it gets no handler.
  if (photos.length && heroEl) {
    heroEl.addEventListener('click', (e) => {
      const tile = e.target.closest('.collage-tile');
      if (!tile) return;
      const i = [...heroEl.querySelectorAll('.collage-tile')].indexOf(tile);
      if (i >= 0 && i < photos.length) openLightbox(photos, i);
    });
  }
  document.getElementById('shareBtn')?.addEventListener('click', async () => {
    const url = location.origin + '/?v=' + v.id;
    const title = (v.short_name || v.name) + ' — Paisaidee';
    if (navigator.share) {
      try { await navigator.share({ title, url }); } catch(e) {}
    } else {
      await navigator.clipboard.writeText(url);
      // the button's content is an SVG now, not an emoji glyph, so the
      // confirmation swaps the whole innerHTML and restores it rather than
      // rewriting a text node
      const btn = document.getElementById('shareBtn');
      if (btn) {
        const prev = btn.innerHTML;
        btn.innerHTML = icoCheck(16) + (btn.classList.contains('vd-btn-icon') ? '' : '<span>Copied</span>');
        setTimeout(() => { btn.innerHTML = prev; }, 1500);
      }
    }
  });
  // description: first sentence up front, the rest revealed in place — no
  // modal, and the link removes itself once there's nothing left to reveal
  const dm = document.getElementById('descMore');
  if (dm) dm.addEventListener('click', () => {
    document.getElementById('vdDesc')?.classList.add('open');
    dm.remove();
  });
  const ht = document.getElementById('hoursToggle');
  if (ht) ht.addEventListener('click', () =>
    document.getElementById('hoursWeek').classList.toggle('show'));

  const cbtn = document.getElementById('checkinBtn');
  if (cbtn) {
    updateCheckinButton(v);
    cbtn.addEventListener('click', () => doCheckin(v));
  }

  const dirBtn = document.getElementById('dirBtn');
  if (dirBtn) dirBtn.addEventListener('click', () => toggleRoute(v));

  if (hasStickyRoute) {
    // rebuilding the sheet's HTML wiped dirBtn's dataset and label — put
    // them back so "Hide route" still works and the map stays framed on
    // the route instead of re-centring on the venue
    dirBtn.dataset.showing = '1';
    document.getElementById('dirLbl').textContent = 'Hide route';
    const attr = document.getElementById('routeAttribution');
    if (attr) attr.innerHTML = '<div class="hint">routing © OpenStreetMap contributors</div>';
  } else if (state.map && v.lat != null && v.lng != null) {
    /* `state.map &&` is not defensive padding. maplibre-gl.js is loaded
       async from a CDN and boot() is explicitly written to carry on without
       it (see maplibreReady()), so state.map stays null on any load where
       that script 404s, is blocked, or the device refuses a WebGL context —
       and this line is the LAST statement in openVenue(). Measured with the
       library 404ing: every venue tap threw
       "TypeError: Cannot read properties of null (reading 'flyTo')",
       which silently killed the rest of whatever handler opened the venue.
       The null check on lat/lng next to it is the separate pending-venue
       case (CLAUDE.md: a pending venue has no coordinates yet). */
    state.map.flyTo({ center: [v.lng, v.lat], zoom: 15.5, speed: 1.4 });
  }
}

/* on-demand road routing for the venue sheet currently open only — never for
   the whole venue list, that would burn the daily ORS quota immediately */
async function toggleRoute(v) {
  const dirBtn = document.getElementById('dirBtn');
  const lbl = document.getElementById('dirLbl');
  if (!dirBtn || !lbl) return;

  if (dirBtn.dataset.showing === '1') {
    clearRoute();       // also resets dirBtn/dirLbl/routeAttribution and hides #routeBar
    return;
  }

  if (!state.userPos) {
    lbl.textContent = 'Finding you…';
    dirBtn.disabled = true;
    const pos = await requestLocation();
    dirBtn.disabled = false;
    if (!pos) {
      /* no fix, but the venue's own Google Maps link sits further down this
         same sheet and needs no location from us at all. The button used to
         say "Location blocked" for 2.5s and go back to "Directions", which
         left the one thing that would work unmentioned. Now the failure
         names it, brings it into view and rings it. A timeout is different
         — the fix may simply be slow — so it still asks for a retry. Venues
         without a Maps link keep the old messages. The ring is static (no
         animation), so reduced motion needs nothing extra; the scroll goes
         through scrollBehavior() for the same reason. */
      const mapsLink = document.getElementById('vdMapsLink');
      if (mapsLink && state.geoError !== 'timeout') {
        lbl.textContent = 'Use Google Maps ↓';
        mapsLink.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
        mapsLink.classList.add('vd-link-ring');
        setTimeout(() => mapsLink.classList.remove('vd-link-ring'), 3000);
        setTimeout(() => { if (lbl.isConnected) lbl.textContent = 'Directions'; }, 4000);
        return;
      }
      lbl.textContent =
        state.geoError === 'blocked' ? 'Location blocked' :
        state.geoError === 'timeout' ? 'Timed out — retry' : 'No location';
      setTimeout(() => { lbl.textContent = 'Directions'; }, 2500);
      return;
    }
    updateCheckinButton(v);
  }

  lbl.innerHTML = `${loadingRing(14)}Finding route…`;
  dirBtn.disabled = true;
  // instant feedback: straight-line distance now, routed distance/time once
  // the fetch below lands — the user gets something useful in well under a
  // second even when the ORS round trip takes several
  const travelEl = document.getElementById('travelLine');
  if (travelEl) {
    travelEl.innerHTML = `${fmtDist(haversine(state.userPos, v))} away · straight line` +
      `<span class="travel-measuring">measuring route…</span>`;
  }
  try {
    const p = new URLSearchParams({
      from_lat: state.userPos.lat, from_lng: state.userPos.lng,
      to_lat: v.lat, to_lng: v.lng, mode: 'driving-car',
    });
    const data = await (await fetch('/api/route?' + p)).json();
    if (state.selectedId !== v.id) return; // sheet moved on while we waited
    dirBtn.disabled = false;
    if (!data.ok || !data.geometry) throw new Error('no route');

    const mins = Math.max(1, Math.round(data.duration_s / 60));
    const label = `${fmtDist(data.distance_m)} · ${mins} min drive`;
    if (travelEl) travelEl.innerHTML = label;
    const attr = document.getElementById('routeAttribution');
    if (attr) attr.innerHTML = '<div class="hint">routing © OpenStreetMap contributors</div>';

    // beyond this range the line on the map is unreadable and unfencing the
    // map to fit it is disorienting — the distance/time above is enough
    if (data.distance_m > 40000) {
      lbl.textContent = 'Too far to map';
    } else if (isMobile()) {
      // the venue detail covers the whole screen here with no map visible
      // behind it (#map itself is never hidden — see the mobile screen-
      // shell comment in style.css — it's just covered in z-order) —
      // drawing the route now would draw it under an opaque sheet nobody
      // can see, which is the exact bug this branch exists to fix.
      // leaveVenue() must run BEFORE showRoute(), synchronously, in this
      // order and on this tick: leaveVenue() unconditionally clears any
      // current route as part of closing the venue (wiping the very route
      // we're about to draw if the order were reversed), and it also
      // queues its own requestAnimationFrame that re-centres the camera to
      // HOME_VIEW unless state.currentRouteGeometry is already set by the
      // time that frame runs — deferring showRoute() to a later frame
      // would lose that race and cause a visible flick to HOME_VIEW right
      // before the route's own fitBounds.
      const venueName = v.short_name || v.name;
      leaveVenue('map');
      state.routeLabel = label;
      showRoute(data.geometry, v.id);
      showRouteBar(label, venueName);
    } else {
      state.routeLabel = label;
      showRoute(data.geometry, v.id);
      showRouteBar(label);
      lbl.textContent = 'Hide route';
      dirBtn.dataset.showing = '1';
    }
  } catch (e) {
    dirBtn.disabled = false;
    lbl.textContent = 'Route unavailable';
    if (travelEl) travelEl.innerHTML = `${fmtDist(haversine(state.userPos, v))} away · straight line`;
    setTimeout(() => {
      const l = document.getElementById('dirLbl');
      if (l && l.textContent === 'Route unavailable') l.textContent = 'Directions';
    }, 2000);
  }
}

/* ---------- route drawing ---------- */
function updateUserMarker() {
  if (!state.userPos) return;
  // boot()'s silent geolocation request now runs while maplibre-gl.js is
  // still downloading, so a coarse fix can arrive before the map exists —
  // renderMarkersOnce() in initMap() calls this again once it does
  if (!state.map) return;
  if (state.userMarker) {
    state.userMarker.setLngLat([state.userPos.lng, state.userPos.lat]);
    return;
  }
  const el = document.createElement('div');
  el.className = 'user-dot';
  state.userMarker = new maplibregl.Marker({ element: el })
    .setLngLat([state.userPos.lng, state.userPos.lat])
    .addTo(state.map);
}

function routeCasingColor() {
  return state.theme === 'light' ? '#FFFCF5' : '#0B0910';
}

/* re-adds the route source/layers (and refreshes the casing colour) —
   split out from showRoute() so the style.load handler in initMap() can
   redraw the route after a theme change without re-running fitBounds.
   setStyle() (used on theme change) wipes any runtime-added sources/layers,
   so this can't just be a setPaintProperty call — the layers have to be able
   to not exist and get recreated. (It used to swap between two structurally
   unrelated styles, raster for night and vector for day; both are vector
   now, and setStyle still wipes runtime layers either way.) */
function drawRouteLayers(geometry) {
  const data = { type: 'Feature', geometry, properties: {} };
  if (state.map.getSource('route')) {
    state.map.getSource('route').setData(data);
  } else {
    state.map.addSource('route', { type: 'geojson', data });
    // casing underneath so the line reads on both light and dark tiles
    state.map.addLayer({
      id: 'route-casing', type: 'line', source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': routeCasingColor(), 'line-width': 8, 'line-opacity': .55 }
    });
    state.map.addLayer({
      id: 'route-line', type: 'line', source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#FF5A3C', 'line-width': 4 }
    });
  }
  if (state.map.getLayer('route-casing')) {
    state.map.setPaintProperty('route-casing', 'line-color', routeCasingColor());
  }
}

// frame the whole route, leaving room for the panel — split out from
// showRoute() so tapping #routeBar can re-frame without redrawing the layers
function frameRoute(geometry) {
  const b = new maplibregl.LngLatBounds();
  geometry.coordinates.forEach(c => b.extend(c));
  const sheetOpen = window.innerWidth >= 768
    && !document.getElementById('sheet')?.classList.contains('collapsed');
  state.map.fitBounds(b, {
    padding: { top: 80, bottom: 80, right: 40,
               left: sheetOpen ? 460 : 40 }
  });
}

function showRoute(geometry, venueId) {
  updateUserMarker();
  state.currentRouteGeometry = geometry;
  state.routeVenueId = venueId;   // makes the venue sticky — see goHome()
  drawRouteLayers(geometry);

  // routes can run well outside the normal city fence — lift it while shown,
  // clearRoute() puts it back
  state.map.setMaxBounds(null);
  state.map.setMinZoom(9);
  frameRoute(geometry);
}

// small persistent bar shown whenever a route is drawn — lives outside the
// sheet entirely (static markup in index.html) so it survives the venue
// sheet closing, the home sheet re-rendering, or the sheet collapsing.
// venueName is only passed on mobile (see toggleRoute()) — the venue detail
// is closed there, so nothing else on screen says where the route goes;
// desktop's docked sheet already shows that, so its bar stays label-only.
function showRouteBar(label, venueName) {
  const bar = document.getElementById('routeBar');
  document.getElementById('routeBarLabel').textContent = venueName ? `${label} · ${venueName}` : label;
  bar.hidden = false;
}

function hideRouteBar() {
  const bar = document.getElementById('routeBar');
  if (bar) bar.hidden = true;
}

function bindRouteBar() {
  const bar = document.getElementById('routeBar');
  bar.addEventListener('click', (e) => {
    if (e.target.closest('#routeBarClose')) { clearRoute(); return; }
    // mobile: the venue detail is closed while a route shows (see
    // toggleRoute()), so there's nowhere else to re-open it from — tapping
    // the bar reopens it. Desktop's sheet is already open alongside the
    // map, so it keeps the old re-frame-on-tap behaviour instead.
    if (isMobile() && state.routeVenueId) { openVenue(state.routeVenueId); return; }
    if (state.currentRouteGeometry) frameRoute(state.currentRouteGeometry);
  });
}

// shown once, only if boot()'s map-load race times out — static markup in
// index.html, a persistent sibling of #sheetInner so it survives every
// setSheet() re-render until the user dismisses it
function showMapWarning() {
  const el = document.getElementById('mapWarning');
  if (el) el.hidden = false;
}

function bindMapWarning() {
  document.getElementById('mapWarningClose')?.addEventListener('click', () => {
    document.getElementById('mapWarning').hidden = true;
  });
}

// shown when /api/venues had to fall back to the bundled data/venues.json
// mirror (see functions/api/venues.js) because the live D1 query failed —
// same persistent-sibling-of-#sheetInner pattern as showMapWarning() above
function showStaleWarning() {
  const el = document.getElementById('staleWarning');
  if (el) el.hidden = false;
}

/* #mapWarning says "the list still works", which is true and enough while
   the list is the thing on screen. On mobile it is NOT enough, because
   tapping Map hides #sheet entirely (see setMobileScreen()) — and #mapWarning
   lives inside #sheet, so the one sentence explaining the empty screen is
   hidden along with it. Measured with maplibre-gl.js 404ing: the Map tab was
   a completely blank viewport, no map, no list, no text, with only the
   bottom nav to get out of it.
   This writes into #map itself, which is the element that is actually empty,
   so it survives the sheet being hidden and needs no new markup in
   index.html. Only ever called when there is no map at all — a map that
   loaded but whose TILES failed still draws its own canvas, its markers and
   its attribution, and #mapWarning is the right (and only) notice for
   that. */
function showMapUnavailable() {
  const el = document.getElementById('map');
  if (!el || el.querySelector('.map-unavailable')) return;
  el.innerHTML = `
    <div class="map-unavailable">
      <div class="map-unavailable-h">The map didn't load</div>
      <div>This is usually the connection. The venue list still works — tap Home.</div>
    </div>`;
}

function bindStaleWarning() {
  document.getElementById('staleWarningClose')?.addEventListener('click', () => {
    document.getElementById('staleWarning').hidden = true;
  });
}

/* The only total failure this app has: neither data/venues.json nor
   /api/venues could be read, so there is no venue list at all. Not a
   dismissible banner like the two above — those sit alongside content that
   still works, and there is none here. It replaces the list, because the
   list is what is missing.
   Written because boot()'s catch used to be `console.error` and nothing
   else: every path into it ended with the splash lifting on an empty screen
   and no way to tell whether the app was broken or Vientiane was. CLAUDE.md
   records this exact outcome happening in production twice. A user staring
   at a blank sheet cannot open a console, and cannot know that reloading is
   worth trying.
   No auto-retry: both sources have already failed once, a silent loop would
   hammer a Worker that is probably already unwell, and the honest control
   for "this may just be your connection" is a button the person chooses to
   press. */
function showDataFailure() {
  const inner = document.getElementById('sheetInner');
  if (!inner) return;
  inner.innerHTML = `
    <div class="sec-empty" style="padding:38px 8px;">
      <div class="sec-empty-ico" data-empty-svg></div>
      <div style="font-weight:700;margin-bottom:6px;">Couldn't load any venues</div>
      <div>This is usually the connection. Nothing is lost — try again.</div>
      <button type="button" id="dataFailRetry" class="btn btn-go" style="margin:16px auto 0;max-width:220px;">Try again</button>
    </div>`;
  // same helper every other empty state uses; it is document-wide and
  // fire-and-forget, so a slow assets/404.svg cannot hold this message up
  injectEmptyIcons();
  document.getElementById('dataFailRetry')?.addEventListener('click', () => location.reload());
}

function clearRoute() {
  state.currentRouteGeometry = null;
  state.routeVenueId = null;
  state.routeLabel = null;
  state.map.setMaxBounds(MAP_BOUNDS.maxBounds);
  state.map.setMinZoom(MAP_BOUNDS.minZoom);
  ['route-line', 'route-casing'].forEach(id => {
    if (state.map.getLayer(id)) state.map.removeLayer(id);
  });
  if (state.map.getSource('route')) state.map.removeSource('route');
  hideRouteBar();
  const dirBtn = document.getElementById('dirBtn');
  if (dirBtn && dirBtn.dataset.showing === '1') {
    dirBtn.dataset.showing = '';
    document.getElementById('dirLbl').textContent = 'Directions';
    const attr = document.getElementById('routeAttribution');
    if (attr) attr.innerHTML = '';
  }
}

async function doCheckin(v) {
  const btn = document.getElementById('checkinBtn');
  if (btn) { btn.disabled = true; document.getElementById('checkinLabel').textContent = 'Checking in…'; }
  try {
    const res = await fetch('/api/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venue_id: v.id, lat: state.userPos.lat, lng: state.userPos.lng }),
    });
    const data = await res.json();
    if (res.status === 401 || data.need_auth) {
      document.getElementById('checkinLabel').textContent = 'Sign in to check in';
      if (btn) btn.disabled = false;
      openFlameSheet();
    } else if (data.ok) {
      const afterVisited = data.visited_venue_ids || [];
      const beforeVisited = data.first_visit ? afterVisited.filter(id => id !== v.id) : afterVisited;
      const toCounts = ids => Object.fromEntries(ids.map(id => [id, 1]));
      const itemsBefore = earnedItems(toCounts(beforeVisited)).map(it => it.id);
      data.new_items = earnedItems(toCounts(afterVisited)).filter(it => !itemsBefore.includes(it.id));
      showCelebration(data);
    } else if (data.already) {
      document.getElementById('checkinLabel').textContent = 'Already checked in tonight';
    } else if (data.too_far) {
      if (Number.isFinite(data.radius_m)) state.checkinRadiusM = data.radius_m;
      document.getElementById('checkinLabel').textContent = 'Too far to check in';
    } else if (data.closed) {
      document.getElementById('checkinLabel').textContent = data.message || 'that place is closed right now';
    } else if (data.same_spot) {
      document.getElementById('checkinLabel').textContent = data.message || "you haven't moved since your last check-in";
    } else if (data.limit) {
      // functions/api/checkin.js's nightly cap. Had no branch, so it fell to
      // the else below — "Check-in failed, try again" with the button
      // re-enabled, inviting a retry the server will refuse every time.
      document.getElementById('checkinLabel').textContent = data.message || 'check-in limit reached for tonight';
    } else {
      document.getElementById('checkinLabel').textContent = 'Check-in failed, try again';
      if (btn) btn.disabled = false;
    }
  } catch (e) {
    document.getElementById('checkinLabel').textContent = 'Connection error, try again';
    if (btn) btn.disabled = false;
  }
}

function showCelebration(data) {
  const stageLabels = { ember:'Ember', flicker:'Flicker', flame:'Flame', blaze:'Blaze', naga:'Naga fire' };
  const hasNewBadges = data.new_badges?.length > 0;
  const ov = document.createElement('div');
  ov.className = 'celebrate';
  ov.innerHTML = `
    <div class="cel-card">
      <div class="cel-flame">🔥</div>
      <div class="cel-title">Checked in!</div>
      <div class="cel-venue">${esc(data.venue)}</div>
      <div class="cel-embers"><span class="cel-num" data-target="${data.embers_earned}">0</span><span class="cel-unit">embers</span></div>
      ${hasNewBadges ? '<div class="cel-badge-unlock" data-badge-svg></div>' : ''}
      <div class="cel-rows">
        <div class="cel-row"><span>Streak</span><b>${data.streak_months} month${data.streak_months>1?'s':''}</b></div>
        <div class="cel-row"><span>Your flame</span><b>${stageLabels[data.phai_stage]||data.phai_stage}</b></div>
        ${data.heat_level && data.heat_level !== data.prev_heat_level ? `<div class="cel-row"><span>Heat</span><b>${cap(data.heat_level)}</b></div>` : ''}
        ${data.first_visit ? '<div class="cel-row cel-new"><span>First visit here</span><b>+bonus</b></div>' : `<div class="cel-row"><span>Visits here</span><b>${data.venue_checkins}</b></div>`}
        ${data.new_badges?.length ? data.new_badges.map(b =>
          `<div class="cel-row cel-badge"><span class="cel-badge-label">${badgeIcon(b, 16)}${esc(b.name)}</span><b>unlocked</b></div>`
        ).join('') : ''}
        ${data.new_items?.length ? data.new_items.map(it =>
          `<div class="cel-row cel-badge"><span>${esc(it.name)} unlocked</span><b>new</b></div>`
        ).join('') : ''}
      </div>
      ${data.capped ? '<div class="cel-capped">daily ember cap reached — check-in still counted</div>' : ''}
      <button class="btn cel-done">Nice</button>
      <div class="cel-confetti" data-confetti-svg></div>
    </div>`;
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('show'));
  confettiSvg().then(html => {
    const el = ov.querySelector('[data-confetti-svg]');
    if (el) playOnceInto(el, html);
  });
  if (hasNewBadges) {
    badgeUnlockSvg().then(html => {
      const el = ov.querySelector('[data-badge-svg]');
      if (el) playOnceInto(el, html);
    });
  }
  // count-up
  const num = ov.querySelector('.cel-num');
  const target = +num.dataset.target;
  let n = 0;
  const step = Math.max(1, Math.round(target/20));
  const t = setInterval(() => { n = Math.min(target, n+step); num.textContent = n; if (n>=target) clearInterval(t); }, 40);
  // to You, not Home: the flame this check-in just fed, the streak and any
  // badge it just unlocked all live there, and the celebration is the one
  // moment someone is sure to want to look. Home was the old destination.
  ov.querySelector('.cel-done').addEventListener('click', () => {
    ov.classList.remove('show');
    setTimeout(() => ov.remove(), 300);
    closeLightbox();
    if (state.map) clearRoute();
    openFlameSheet();
  });
}

/* ---------- helpers ---------- */
// module-level (not local to initSheetDrag) so changeFilterAnimated() can
// also clear them once a committed swipe finishes settling — see endGesture()
let dragging = false;
let axis = null;                         // null (undecided) | 'x' | 'y' | 'none'

// clears all touch-gesture state. Called on every gesture exit path —
// touchend, touchcancel, defensively at the top of touchstart, and once a
// committed swipe settles — so a stray touchcancel, a second finger landing
// mid-drag, or a backgrounded tab can never leave #sheet stuck at
// overflow:hidden (the .dragging class) or the axis lock stuck at 'x'.
function endGesture() {
  dragging = false;
  axis = null;
  const sheet = document.getElementById('sheet');
  if (sheet) {
    sheet.classList.remove('dragging');
    sheet.style.transform = '';    // a cancelled vertical drag must not leave #sheet stuck mid-slide
  }
  const inner = document.getElementById('sheetInner');
  if (inner) {
    inner.classList.remove('swiping');
    inner.style.transform = '';
    inner.style.opacity = '';
  }
}

function initSheetDrag() {
  let startX = 0, startY = 0, startOffset = 0, offset = 0, dx = 0, startScrollTop = 0;
  const getSheet = () => document.getElementById('sheet');
  const maxOffset = () => Math.max(0, getSheet().offsetHeight - 84);

  // a drag may start from the handle always, from the title/subtitle only
  // when the list is scrolled to the top, or anywhere on a collapsed sheet
  // — except on mobile, where the collapse gesture has no meaning any more
  // now that Home/You are full screens (see the mobile screen-shell CSS):
  // without this, a vertical drag would still move #sheet via inline style
  // (which beats that CSS) and then spring back on release, reading as
  // broken. This only disables the vertical branch below — the horizontal
  // filter-swipe (axis === 'x') doesn't consult canDrag()/dragging at all.
  const canDrag = (e, sheet) => {
    if (window.innerWidth < 768) return false;
    if (e.target.closest('#sheetHandle')) return true;
    if (sheet.classList.contains('collapsed')) return true;
    if (sheet.scrollTop > 0) return false;
    // .s-subrow, not just .s-sub: the subhead now shares its row with the
    // weather widget, so the gap between them is the row's own box and a
    // drag starting there would otherwise fall through to "not a handle".
    return !!e.target.closest('.s-title, .s-subrow, .s-sub');
  };

  // horizontal filter-swipe only applies to the home list: not while a venue
  // detail or the avatar sheet is open (#sheet.expanded), not starting on a
  // horizontal scroller of its own (.hcards on desktop, .fire-rail — On
  // fire's mobile carousel — since Sleek item 24: both scroll themselves,
  // and a sideways drag inside one was reaching this handler and changing
  // the filter tab instead of scrolling the rail), and not on #sheetHandle
  // (vertical target). Both classes also carry touch-action: pan-x in
  // style.css so the browser cannot hand a diagonal drag up to #sheet
  // either — the exclusion and the touch-action are a pair, neither is
  // sufficient alone.
  // ...and not on the sticky chip bar itself. Since Sleek item 18 made the
  // chip labels bilingual the row is wider than a narrow phone (~344px and
  // below) and scrolls, and "Events" — the last chip — starts off-screen.
  // The bar already carries touch-action: pan-x (style.css), but this
  // handler was still claiming the drag and preventDefault()ing the native
  // pan, so the filter simply could not be reached on those phones. Being
  // able to scroll the control wins over being able to change tabs FROM the
  // control: the chips are tappable, and the swipe still works everywhere
  // else on the sheet.
  const canSwipeX = e => !sheet.classList.contains('expanded')
    && !e.target.closest('.hcards') && !e.target.closest('.fire-rail')
    && !e.target.closest('#sheet .chip-bar')
    && !e.target.closest('#sheetHandle');

  // touchstart/move/end are delegated on #sheet itself (a static element —
  // only its #sheetInner child's content is replaced on each render)
  const sheet = getSheet();

  sheet.addEventListener('touchstart', e => {
    if (window.innerWidth >= 768) return;
    if (e.touches.length > 1) { endGesture(); return; }   // a second finger mid-drag is a common way to strand this state
    endGesture();           // defensive: clear anything a missed touchend/touchcancel left behind
    dx = 0;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    startScrollTop = sheet.scrollTop;
    dragging = canDrag(e, sheet);
    if (dragging) {
      startOffset = sheet.classList.contains('collapsed') ? maxOffset() : 0;
      offset = startOffset;
      sheet.classList.add('dragging');
    }
  }, { passive: true });

  sheet.addEventListener('touchmove', e => {
    if (window.innerWidth >= 768) return;
    const t = e.touches[0];
    const moveX = t.clientX - startX;
    const moveY = t.clientY - startY;
    if (axis === null) {
      // vertical scrolling has to beat the filter-swipe: a thumb travelling up
      // or down naturally drifts sideways, and the old symmetric 12px test was
      // eager enough that the drift alone could lock 'x' and change the filter
      // mid-scroll. Two guards now — a 20px minimum on whichever axis is
      // currently winning (the gesture must be deliberate before it commits to
      // anything), and a 1.8x dominance ratio before 'x' may win at all.
      // Vertical needs no ratio: scrolling wins every tie, on purpose.
      const ax = Math.abs(moveX), ay = Math.abs(moveY);
      const wantsX = ax >= ay * 1.8;
      if ((wantsX ? ax : ay) <= 20) return;
      axis = wantsX ? 'x' : 'y';
      if (axis === 'x' && !canSwipeX(e)) axis = 'none';
    }
    if (axis === 'y') {
      if (!dragging) return;
      e.preventDefault();                // block the browser's own scroll/zoom
      offset = Math.min(maxOffset(), Math.max(0, startOffset + moveY));
      sheet.style.transform = `translateY(${offset}px)`;
    } else if (axis === 'x') {
      e.preventDefault();
      dx = moveX;
      if (!prefersReducedMotion()) {
        const inner = document.getElementById('sheetInner');
        const W = sheet.clientWidth;
        const order = filterOrder();
        const i = order.indexOf(state.filter || 'all');
        const atEnd = (dx < 0 && i === order.length - 1) || (dx > 0 && i === 0);
        const move = atEnd ? dx * 0.25 : dx;          // resistance at the ends
        inner.classList.add('swiping');
        inner.style.transform = `translateX(${move}px)`;
        inner.style.opacity = String(1 - Math.min(0.45, Math.abs(move) / W));
      }
    }
    // axis === 'none': let the touch fall through to native scrolling
    // (.hcards, .fire-rail)
  }, { passive: false });

  const onEnd = () => {
    if (axis === 'y' && dragging) {
      sheet.style.transform = '';        // hand control back to the class
      sheet.scrollTop = startScrollTop;  // in case any scroll slipped through
      toggleSheet(offset > maxOffset() / 2);
      endGesture();
    } else if (axis === 'x') {
      const order = filterOrder();
      const i = order.indexOf(state.filter || 'all');
      const atEnd = (dx < 0 && i === order.length - 1) || (dx > 0 && i === 0);
      const commit = Math.abs(dx) > 60 && !atEnd;
      if (prefersReducedMotion()) {
        if (commit) changeFilter(dx < 0 ? 1 : -1);      // instant switch, no follow/slide
        endGesture();
      } else if (commit) {
        // don't call endGesture() here — it would reset #sheetInner's
        // transform/opacity mid-flight and cut the exit/entry slide short.
        // changeFilterAnimated() clears the gesture state itself once the
        // swipe settles (see its own endGesture() call).
        changeFilterAnimated(dx < 0 ? 1 : -1);
      } else {
        changeFilterAnimated(0);         // snap back; synchronous, safe to clear right after
        endGesture();
      }
    } else {
      endGesture();
    }
  };
  sheet.addEventListener('touchend', onEnd);
  sheet.addEventListener('touchcancel', endGesture);
}

// order swiped through on mobile; does not wrap at the ends. Must match the
// chip order in index.html. Read through filterOrder(), which drops a type
// chip syncTypeChips() has hidden, so a swipe can't land on a hidden tab.
const FILTER_ORDER = ['all', ...Object.keys(VENUE_TYPE_META).filter(k => VENUE_TYPE_META[k].chip), 'event'];
const filterOrder = () => FILTER_ORDER.filter(k =>
  !chipBarEl.querySelector(`.chip[data-filter="${k}"]`)?.hidden);
const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/* scrollIntoView/scrollTo take their own behavior argument and ignore the
   CSS media query entirely, so the four chip-centring calls and the editor's
   scroll-to-photos were still animating under prefers-reduced-motion. The
   mood carousel (showMoodIntro()) already did this by hand with its own
   `reduced` flag; this is the same decision in one place. */
const scrollBehavior = () => prefersReducedMotion() ? 'auto' : 'smooth';

// instant switch, no animation — used for direct chip taps and for a
// committed swipe under prefers-reduced-motion
function changeFilter(dir) {
  const order = filterOrder();
  const next = order.indexOf(state.filter || 'all') + dir;
  if (next < 0 || next >= order.length) return;
  const chip = chipBarEl.querySelector(`.chip[data-filter="${order[next]}"]`);
  if (!chip) return;
  chip.click();
  chip.scrollIntoView({ inline: 'center', block: 'nearest', behavior: scrollBehavior() });
}

// dir: 0 snaps #sheetInner back to rest; ±1 carries it the rest of the way
// off-screen, swaps the filter, then flies the new content in from the
// opposite side. Mirrors changeFilter()'s indexing (dir>0 = next filter).
function changeFilterAnimated(dir) {
  const inner = document.getElementById('sheetInner');
  const sheet = document.getElementById('sheet');
  const W = sheet.clientWidth;
  inner.classList.remove('swiping');
  inner.classList.add('settling');
  inner.addEventListener('transitionend', () => inner.classList.remove('settling'), { once: true });

  if (!dir) {
    inner.style.transform = 'translateX(0)';
    inner.style.opacity = '1';
    return;
  }

  const order = filterOrder();
  const i = order.indexOf(state.filter || 'all');
  inner.style.transform = `translateX(${-dir * W * 0.35}px)`;
  inner.style.opacity = '0';
  setTimeout(() => {
    state.filter = order[i + dir];
    syncChipState();
    renderMarkers();
    renderHomeSheet();                 // re-renders into #sheetInner, resetting transform/opacity
    // .swiping, not .settling, for this jump to the fly-in start position —
    // .swiping's own transition:none is what keeps the snap instant (the
    // same reason the touchmove drag itself uses .swiping); .settling only
    // takes over next frame so the actual fly-in animates. Either way, the
    // class goes on in the same synchronous block as the transform, not
    // after — renderHomeSheet() just cleared both classes via setSheet(),
    // so leaving even one frame between them applied #sheetInner's real
    // transform with neither class present, which is a real (if narrow)
    // will-change gap even though it isn't the pinned-chip-bar bug.
    inner.classList.remove('settling');
    inner.classList.add('swiping');
    inner.style.transform = `translateX(${dir * W * 0.35}px)`;
    inner.style.opacity = '0';
    requestAnimationFrame(() => {
      inner.classList.remove('swiping');
      inner.classList.add('settling');
      inner.style.transform = 'translateX(0)';
      inner.style.opacity = '1';
    });
    // safety net (see endGesture()): clear the gesture state once the entry
    // settle finishes, unconditionally — not just on a clean transitionend.
    // A backgrounded tab pauses CSS transitions, so transitionend can simply
    // never fire; the fallback timer covers that. endGesture() is idempotent,
    // so both firing is harmless.
    const finishGesture = () => { inner.classList.remove('settling'); endGesture(); };
    inner.addEventListener('transitionend', finishGesture, { once: true });
    setTimeout(finishGesture, 300);
    const activeChip = chipBarEl.querySelector('.chip.on');
    if (activeChip) activeChip.scrollIntoView({ inline: 'center', block: 'nearest', behavior: scrollBehavior() });
  }, 200);
}

function toggleSheet(force) {
  const sh = document.getElementById('sheet');
  const collapsed = force !== undefined ? force : !sh.classList.contains('collapsed');
  sh.classList.toggle('collapsed', collapsed);
  localStorage.setItem('psd-sheet-collapsed', collapsed ? '1' : '0');
}

function setSheet(html) {
  closeVibePop(); // every render path routes through here — never leave a stale popup over fresh content
  const sheet = document.getElementById('sheet');
  sheet.classList.toggle('expanded', html.includes('data-venue-detail'));
  // #sheetHandle is a persistent sibling of #sheetInner (see index.html) —
  // only #sheetInner's content is replaced, so a horizontal filter-swipe
  // can animate it without fighting the sheet's own vertical scroll/
  // collapse transform. chipBar used to be a permanent sibling too; on
  // mobile Home it's now placed inside #sheetInner's own content (below
  // the greeting, above the first section — see renderHomeSheet()'s
  // #chipSlot marker) so it scrolls with the list, so it has to be
  // re-homed into the freshly-rendered markup below instead.
  const inner = document.getElementById('sheetInner');
  inner.innerHTML = html;
  // undo any in-progress swipe animation left over from changeFilterAnimated()
  inner.classList.remove('swiping', 'settling');
  inner.style.transform = '';
  inner.style.opacity = '';
  inner.classList.remove('anim');
  void inner.offsetWidth;
  // mobile Home/bar/cafe renders carry a #chipSlot placeholder; drop chipBar
  // in there. Every other render (venue detail, You, desktop) has no slot,
  // so falls back to placeChips()'s topbar/sheet-sibling placement.
  const chipSlot = isMobile() ? inner.querySelector('#chipSlot') : null;
  if (chipSlot) {
    chipSlot.replaceWith(chipBarEl);
    observeChipPin();
  } else {
    chipPinObserver?.disconnect();
    chipBarEl.classList.remove('pinned');
    placeChips();
  }
  inner.classList.add('anim');
  inner.querySelectorAll('[data-open-venue]').forEach(el =>
    el.addEventListener('click', () => openVenue(el.dataset.openVenue)));
  inner.querySelectorAll('[data-cafe-tab]').forEach(el =>
    el.addEventListener('click', () => {
      state.cafeTab = el.dataset.cafeTab;
      renderHomeSheet();
    }));
  inner.querySelectorAll('[data-cat]').forEach(el =>
    el.addEventListener('click', () =>
      chipBarEl.querySelector(`.chip[data-filter="${el.dataset.cat}"]`)?.click()));
  inner.querySelectorAll('[data-see-all]').forEach(el =>
    el.addEventListener('click', () =>
      chipBarEl.querySelector(`.chip[data-filter="${el.dataset.seeAll}"]`)?.click()));
  inner.querySelectorAll('[data-dist]').forEach(el =>
    el.addEventListener('click', () => {
      state.distanceFilterM = el.dataset.dist === '' ? null : Number(el.dataset.dist);
      renderHomeSheet();
    }));
  inner.querySelectorAll('[data-mood-relink]').forEach(el =>
    el.addEventListener('click', () => showMoodIntro({ startAtMood: true })));
  inner.querySelectorAll('[data-surprise-me]').forEach(el =>
    el.addEventListener('click', () => quickSurpriseMe(state.filter)));
  inner.querySelectorAll('[data-home]').forEach(el =>
    el.addEventListener('click', () => {
      // the venue detail's back arrow / close button. On mobile it returns to
      // whichever screen the venue was opened over (Home, Map or You) rather
      // than always Home — see leaveVenue(). Desktop has no such screens and
      // always goes Home, but it goes there THROUGH leaveVenue() too: that is
      // the one function that knows what a venue put on screen and has to be
      // torn down with it (the photo lightbox included — see its
      // closeLightbox() call). The desktop branch used to fall through to the
      // generic renderHomeSheet() below instead, which is why closing a venue
      // on desktop left the lightbox covering the list; the fix is this
      // routing, not a second closeLightbox() call to keep in sync with the
      // first. state.screenBeforeVenue is deliberately not consulted off
      // mobile: a venue opened below the breakpoint and closed after a resize
      // could have it set to 'map' or 'you', neither of which desktop renders.
      // Every other data-home button (the sign-in prompt's and flame sheet's
      // "Done") is not a venue view, so it still means plain "go home".
      if (state.sheetView.type === 'venue') {
        leaveVenue(isMobile() ? (state.screenBeforeVenue || 'home') : 'home');
        return;
      }
      stopTracking();
      if (state.map) clearRoute();     // explicit "leave this sheet" action — the route dies with it
      renderHomeSheet();
    }));
}

/* a type chip with no venues behind it is a tab that can only ever say
   "Nothing here right now" — hide it rather than ship a dead end. This is
   what lets the restaurant plumbing merge before the first restaurant is
   entered: the chip appears on its own once one exists. Applies to every
   type chip, so a bar/café list that ever empties out gets the same. If the
   current filter's chip just disappeared, fall back to All. */
function syncTypeChips() {
  /* every chip lookup in this file reads chipBarEl, never document: since
     the All tab shows category tiles instead of the chip row, the bar is
     detached from the page on mobile All, and document.querySelectorAll()
     would silently skip it — the active chip would stop tracking the
     filter, and a hidden Restaurants chip would count as visible. */
  for (const ch of chipBarEl.querySelectorAll('.chip')) {
    if (!VENUE_TYPE_META[ch.dataset.filter]) continue;
    ch.hidden = !state.venues.some(v => v.type === ch.dataset.filter);
    if (ch.hidden && state.filter === ch.dataset.filter) state.filter = 'all';
  }
}

function syncChipState() {
  chipBarEl.querySelectorAll('.chip').forEach(c =>
    c.classList.toggle('on', c.dataset.filter === (state.filter || 'all')));
}

function bindChips() {
  chipBarEl.querySelectorAll('.chip').forEach(ch => {
    ch.addEventListener('click', () => {
      // desktop shows the chip row beside an open owner form
      if (typeof edBlocksLeave === 'function' && edBlocksLeave(() => ch.click())) return;
      state.filter = ch.dataset.filter;
      syncChipState();
      // a filter change is an explicit "browse elsewhere" action — return to
      // the home list regardless of what the sheet currently shows, and treat
      // a sticky routed venue (state.routeVenueId) the same as pressing back
      state.selectedId = null;
      if (state.map) clearRoute();
      closeLightbox();   // body-level overlay, survives the re-render — see goHome()
      renderHomeSheet();
      updateSelection();
      renderMarkers();
      const sheet = document.getElementById('sheet');
      if (sheet.classList.contains('collapsed')) toggleSheet(false);
      // keep the tapped chip in view within the scrollable chip row itself —
      // same { inline, block: 'nearest' } shape used after a swipe-driven
      // filter change (see changeFilterAnimated()) so a chip near either
      // edge doesn't get left half-hidden
      ch.scrollIntoView({ inline: 'center', block: 'nearest', behavior: scrollBehavior() });
    });
  });
}

/* short labels so the pill's width barely moves between states — "located"
   reuses "near me" and relies on .is-on (colour) to read as active */
const LOCATE_LABELS = {
  idle: 'near me',
  locating: 'finding you',
  located: 'near me',
  blocked: 'location off',
  timeout: 'try again',
  unavailable: 'no signal',
  // every state.geoError value needs a key here — see the list on
  // requestLocation(). 'failed' was missing, and because the lookup falls
  // back to `idle`, a location attempt that threw put the pill back to
  // "near me", which is what it says when nothing has been tried at all.
  failed: 'try again',
  // unreachable in practice (the pill hides itself when there is no
  // geolocation API) but present so the set is complete rather than
  // complete-by-accident
  unsupported: 'no location',
};

// reads state.userPos/state.geoError directly rather than taking an explicit
// state argument, so requestLocation() can call it after updating state
// without both places needing to agree on a status string
function updateLocatePill() {
  const btn = document.getElementById('locateBtn');
  const lbl = document.getElementById('locateLabel');
  if (!btn || !lbl) return;
  if (!hasGeolocation()) { btn.hidden = true; return; }
  btn.hidden = false;
  const key = state.userPos ? 'located' : (state.geoError || 'idle');
  lbl.textContent = LOCATE_LABELS[key] || LOCATE_LABELS.idle;
  btn.classList.toggle('is-on', !!state.userPos);
}

// shown after a retry comes back blocked — the browser won't re-prompt once
// denied, so getCurrentPosition just fails silently; explain how to fix it
function showLocationBlockedMessage() {
  toggleSheet(false);
  setSheet(`
    <div class="s-sub" style="text-align:center;padding:30px 14px;">
      Location is blocked for this site.<br>
      Tap the padlock next to the address bar → Permissions → Location → Allow, then reload.
    </div>
  `);
}

function bindLocate() {
  updateLocatePill();      // initial state — also hides the pill if unsupported
  watchGeoPermission();
  document.getElementById('locateBtn').addEventListener('click', async () => {
    // always retry, even after a previous 'blocked' result — permission may
    // have been granted since, and getCurrentPosition is the only way to know
    state.geoError = null;
    document.getElementById('locateLabel').textContent = LOCATE_LABELS.locating;
    const pos = await requestLocation();
    if (pos) {
      // same reason as openVenue()'s flyTo: no map is a supported state, and
      // without the guard a successful fix on a map-less load threw here and
      // took the updateCheckinButton() call below down with it — so the pill
      // would go green while the check-in button stayed on "Enable location"
      if (state.map) state.map.flyTo({ center: [pos.lng, pos.lat], zoom: 15 });
    } else if (state.geoError === 'blocked') {
      showLocationBlockedMessage();
    }
    if (state.selectedId) {
      const v = venueById(state.selectedId);
      if (v) updateCheckinButton(v);
    }
  });
}

// notices the moment the user flips the browser permission, without needing
// a reload — Chrome/Firefox support 'geolocation' as a permissions descriptor
async function watchGeoPermission() {
  if (!navigator.permissions) return;
  try {
    const p = await navigator.permissions.query({ name: 'geolocation' });
    p.addEventListener('change', () => {
      if (p.state === 'granted') { state.geoError = null; requestLocation(); }
      else updateLocatePill();
    });
  } catch (e) { /* permissions API not queryable for geolocation in this browser */ }
}

/* ---------- tracking mode ---------- */
/* kept for phase 2 check-in radius — no UI currently calls this */
function startTracking(v) {
  if (!navigator.geolocation) return;
  stopTracking();
  state.tracking = v.id;
  state.trackWatchId = navigator.geolocation.watchPosition(
    pos => updateTrack(v, { lat: pos.coords.latitude, lng: pos.coords.longitude }),
    () => stopTracking(),
    { enableHighAccuracy: true }
  );
  const chip = document.getElementById('trackChip');
  if (chip) {
    chip.classList.add('on');
    chip.textContent = 'locating…';
    chip.onclick = stopTracking;
  }
}

function updateTrack(v, pos) {
  state.userPos = pos;
  const m = haversine(pos, v);
  const chip = document.getElementById('trackChip');
  if (chip) {
    chip.textContent = `🔥 ${fmtDist(m)} to ${v.short_name || v.name} — tap to stop`;
  }
  const line = {
    type: 'Feature',
    geometry: { type: 'LineString',
      coordinates: [[pos.lng, pos.lat], [v.lng, v.lat]] },
  };
  if (state.map.getSource('trackline')) {
    state.map.getSource('trackline').setData(line);
  } else {
    state.map.addSource('trackline', { type: 'geojson', data: line });
    state.map.addLayer({
      id: 'trackline', type: 'line', source: 'trackline',
      paint: { 'line-color': '#FF5A3C', 'line-width': 3, 'line-dasharray': [1.5, 1.5] },
    });
  }
  state.map.fitBounds([[pos.lng, pos.lat], [v.lng, v.lat]], { padding: 90, maxZoom: 16 });
}

function stopTracking() {
  if (state.trackWatchId !== null) navigator.geolocation.clearWatch(state.trackWatchId);
  state.trackWatchId = null;
  state.tracking = null;
  const chip = document.getElementById('trackChip');
  if (chip) chip.classList.remove('on');
  if (state.map && state.map.getLayer('trackline')) {
    state.map.removeLayer('trackline');
    state.map.removeSource('trackline');
  }
}

function haversine(a, b) {
  const R = 6371000, rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const fmtDist = m => m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;

const venueById = id => state.venues.find(v => v.id === id);
/* the date test is repeated here even though boot() already dropped every
   past event out of state.events. That filter runs once, at load, against
   todayISO() as it was at load — so a tab left open across midnight (a phone
   in a pocket from 11pm to 1am is the whole point of this app) still has
   yesterday's event sitting in state.events. Home re-derives its own
   `today` on every render, so the Tonight and Upcoming sections drop it on
   their own; the venue sheet read this list raw and would have gone on
   showing a finished event, labelled TONIGHT, until someone reloaded. */
const venueEvents = id => state.events.filter(ev => ev.venue_id === id && !eventExpired(ev));

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const isPast = dateStr => dateStr < todayISO();

/* ---------- repeating events ----------
   A weekly fixture is one record, not fifty-two. Make Friends runs every
   Thursday at Corebeer and the Felicia X live lineup plays Fri/Sat/Sun at
   Status; both were already in data/events.json saying so in their `short`
   line, and both had already silently expired, because a single `date` can
   only ever be true once. The recurrence now lives in a field the app reads:

     "repeat": { "weekly": ["fri", "sat", "sun"], "until": null }

     weekly  DAYS codes ('sun'..'sat'). Missing, empty or not an array means
             the event does not repeat and `date` is the only date it has —
             every existing event is that case and none of them changed.
     until   ISO date of the last occurrence, or null for open-ended.

   `date` does NOT move. It stays the occurrence that source_url actually
   verified, so the provenance of a fixture is still a real night somebody
   checked, and a repeat that has not started yet still shows its true first
   date rather than jumping to this week.

   `until: null` is open-ended, and that is the part to be careful with: a
   repeat is a claim about the FUTURE, and nothing in this file can keep it
   true. A weekly night that quietly stops will go on rendering until someone
   re-checks the source and sets `until`. That is the same trade the app
   already makes for hours (which also go stale silently) and it is why the
   `until` field exists at all — see the note in data/events.json. It is not
   a reason to guess an end date: a wrong `until` hides a night that is still
   running, which is worse than showing one that ended last week. */
/* DAYS is the venue-hours weekday vocabulary further up (openStatus() reads
   v.hours.mon, v.hours.tue...). Reused here rather than copied: it is the
   same seven codes in the same Date.getDay() order, and a second private
   copy is the shape of bug this codebase keeps producing. If DAYS ever has
   to change for hours, this reads it too. */
const repeatDays = ev => (Array.isArray(ev.repeat?.weekly) ? ev.repeat.weekly : [])
  .map(d => DAYS.indexOf(String(d).slice(0, 3).toLowerCase()))
  .filter(i => i >= 0);

const shiftISO = (iso, n) => {
  const d = new Date(iso + 'T00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* the date an event should be SHOWN as. For a one-off that is just `date`,
   past or not — eventExpired() is what decides whether it is shown at all,
   exactly as isPast() did before. For a repeat it is the next matching
   weekday on or after today, never earlier than `date`, or null once
   `until` has gone by. Recomputed on every call rather than cached on the
   record, for the same reason venueEvents() re-tests the date: a phone left
   open from 11pm to 1am must not keep yesterday's answer. */
function eventDate(ev) {
  const days = repeatDays(ev);
  if (!days.length) return ev.date;
  const today = todayISO();
  const from = ev.date > today ? ev.date : today;
  const startDow = new Date(from + 'T00:00').getDay();
  for (let i = 0; i < 7; i++) {
    if (!days.includes((startDow + i) % 7)) continue;
    const iso = shiftISO(from, i);
    return (ev.repeat?.until && iso > ev.repeat.until) ? null : iso;
  }
  return null;
}

const eventExpired = ev => {
  const d = eventDate(ev);
  return d == null || d < todayISO();
};

const fmtDate = iso => {
  const d = new Date(iso + 'T00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
};
const fmtPrice = p => p === 0 ? 'free' : p == null ? 'price tbc' : `${(p / 1000)}k kip`;
const fmtKip = n => '₭' + n.toLocaleString('en-US');

const isNight = () => new Date().getHours() >= 17;

const dayGreeting = () => {
  const day = new Date().getDay();
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return `${names[day]} ${isNight() ? 'night' : ''}`.trim();
};

// Sleek item 8: a small bilingual greeting above the Home headline. The Lao
// half is the plain all-purpose ສະບາຍດີ rather than a time-of-day form —
// that is what the mockup shows, and it is the one greeting that cannot be
// wrong at any hour; only the English half moves with the clock. The
// afternoon/evening cut is 17:00, the same hour isNight() uses, so the
// eyebrow and the headline beneath it never disagree about which it is.
const greetEyebrowHtml = () => {
  const h = new Date().getHours();
  const en = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return `<div class="s-eyebrow"><span class="lao">ສະບາຍດີ</span> · ${en}</div>`;
};

/* first letter up, rest untouched. Was declared inside statusPillHtml();
   lifted here when showCelebration() needed the same thing for heat_level,
   so the two can't capitalise differently. */
const cap = s => String(s ?? '').charAt(0).toUpperCase() + String(s ?? '').slice(1);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

boot();
