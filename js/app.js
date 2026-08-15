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

const COLORS = { bar: 'var(--pin-bar)', cafe: 'var(--pin-cafe)', event: 'var(--pin-venue)', venue: 'var(--pin-venue)' };
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
  screen: 'home',           // mobile only: 'home' | 'map' | 'you' — see setMobileScreen()
  screenBeforeVenue: null,  // mobile only: screen to return to when the open venue closes
  venuePushed: false,       // mobile only: whether openVenue() pushed a history entry for the open venue
  geoAutoAttempted: false,  // boot()'s one silent location request — never retried automatically once this is true, see item 4 in the CLAUDE.md task this was written for
  avatarUrl: null,          // signed-in user's own uploaded profile picture ("<version>/<publicId>"), null = show the chibi instead — see applyAvatarUrl()
};

const isMobile = () => window.innerWidth < 768;

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

// the one place that requests location — the "near me" pill and the
// Directions button both call this so their error handling can't drift apart
async function requestLocation() {
  if (!('geolocation' in navigator)) {
    state.geoError = 'unsupported';
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
    // the 150m check-in radius. refineLocation() chases a sharper fix
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
  } else if (chipBarEl.isConnected) {
    chipBarEl.remove();
  }
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
    const [vRes, eRes, picks] = await Promise.all([
      fetch('/api/venues'),
      fetch('data/events.json'),
      fetch('data/picks.json')
        .then(r => r.ok ? r.json() : Promise.reject(new Error('picks fetch failed: ' + r.status)))
        .catch(e => { console.warn('[muan] picks unavailable', e); return null; }),
    ]);
    const vData = await vRes.json();
    state.venues = vData.venues;
    state.events = (await eRes.json()).events.filter(ev => !isPast(ev.date));
    state.picks = picks;

    initTheme();
    document.querySelector('.brand-mark').innerHTML = logoMark(17, 'var(--ink2)');
    document.getElementById('locateIcon').innerHTML = icoLocate(15);
    document.getElementById('navHomeIcon').innerHTML = icoHomeNav(21);
    document.getElementById('navMapIcon').innerHTML = icoMapNav(21);
    document.getElementById('navYouIcon').innerHTML = icoFlameNav(21);
    bindTheme();
    refreshAvatarBtn();
    document.getElementById('avatarBtn').addEventListener('click', openFlameSheet);
    // fire-and-forget: the only reason to learn avatar_url this early is
    // the top-right button — everywhere else it's read straight off /api/me
    // when the You screen itself opens. Doesn't block or delay anything
    // else in boot(); a signed-out visitor just gets signed_out:true back
    // and the button stays on the chibi/emoji fallback it already shows.
    fetch('/api/me').then(r => r.json()).then(me => {
      if (me?.ok && !me.signed_out) applyAvatarUrl(me.avatar_url || null);
    }).catch(() => {});
    initMap();
    renderHomeSheet();

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
    if (vData.stale) showStaleWarning();
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
    if (state.map) {
      let mapTimedOut = false;
      await Promise.race([
        new Promise(resolve => state.map.once('load', resolve)),
        new Promise(resolve => setTimeout(() => {
          console.warn('[muan] map load timed out after 8s — continuing without it');
          mapTimedOut = true;
          resolve();
        }, 8000)),
      ]);
      if (mapTimedOut) showMapWarning();
    }
  } catch (err) {
    console.error('[muan] boot failed', err);
  } finally {
    // must run whether boot succeeded, threw, or the map never loaded —
    // a splash that never leaves is worse than an unpolished one
    dismissSplash();
  }
}

function dismissSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return;
  const MIN_MS = 600;                    // avoid a jarring flash on fast loads
  const wait = Math.max(0, MIN_MS - (performance.now() - window.__bootStart));
  setTimeout(() => {
    splash.classList.add('gone');
    setTimeout(() => splash.remove(), 500);
  }, wait);
}

/* ---------- theme ---------- */
const TILES = {
  dark: ['a','b','c'].map(s => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png`),
};
const LIGHT_STYLE_URL = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

function resolvedTheme() {
  const pref = localStorage.getItem('muan-theme') || 'auto';
  if (pref !== 'auto') return pref;
  const h = new Date().getHours();
  return (h >= 17 || h < 6) ? 'dark' : 'light';
}

function mapStyle(theme) {
  if (theme === 'light') return LIGHT_STYLE_URL;
  return {
    version: 8,
    sources: {
      carto: {
        type: 'raster',
        tiles: TILES[theme],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      },
    },
    layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
  };
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
  { id:'coffee', type:'cafe',  need:3,  name:'Coffee cup',   name_lo:'ຈອກກາເຟ' },
  { id:'beer',   type:'bar',   need:3,  name:'Beer mug',     name_lo:'ຈອກເບຍ' },
  { id:'ticket', type:'venue', need:3,  name:'Ticket stub',  name_lo:'ປີ້' },
  { id:'crown',  type:'any',   need:20, name:'Explorer cap', name_lo:'ໝວກນັກສຳຫຼວດ' },
];

function earnedItems(venueCounts) {
  const visitedIds = Object.keys(venueCounts);
  const counts = { cafe:0, bar:0, venue:0 };
  visitedIds.forEach(id => {
    const v = venueById(id);
    if (v && counts[v.type] !== undefined) counts[v.type]++;
  });
  return ITEMS.filter(it => it.type === 'any'
    ? visitedIds.length >= it.need
    : counts[it.type] >= it.need);
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

const MAX_AVATAR_BYTES = 4 * 1024 * 1024;

// uploads straight to Cloudinary via the same signed-upload mechanism the
// venue photo uploader uses (see /api/upload-signature's { target: 'avatar'}
// branch, scoped to this user's own paisaidee/users/<id>/ folder), then
// saves the resulting public id server-side — /api/me/avatar rejects
// anything not actually in that folder, same ownership check as venue
// photos have
async function uploadAvatarFile(file) {
  const sigRes = await fetch('/api/upload-signature', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: 'avatar' }),
  });
  const sig = await sigRes.json().catch(() => null);
  if (!sig || !sig.ok) throw new Error(sig?.error || 'could not start upload');

  const form = new FormData();
  form.append('file', file);
  form.append('api_key', sig.api_key);
  form.append('signature', sig.signature);
  for (const [key, value] of Object.entries(sig.params)) form.append(key, value);

  const uploadResult = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${sig.cloud_name}/image/upload`);
    xhr.onload = () => {
      let data;
      try { data = JSON.parse(xhr.responseText); } catch (e) { reject(new Error('upload failed')); return; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data?.error?.message || 'upload failed'));
    };
    xhr.onerror = () => reject(new Error('connection error during upload'));
    xhr.send(form);
  });

  const publicId = `v${uploadResult.version}/${uploadResult.public_id}`;
  const saveRes = await fetch('/api/me/avatar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_id: publicId }),
  });
  const saved = await saveRes.json().catch(() => null);
  if (!saved || !saved.ok) throw new Error(saved?.error || 'could not save photo');
  return saved.avatar_url;
}

// wired fresh on every renderFlameSheetBody() render, same as the sheet's
// other buttons — #pfpBtn/#pfpFile/#pfpErr are only present in that markup
function wirePfpUpload() {
  const btn = document.getElementById('pfpBtn');
  const file = document.getElementById('pfpFile');
  const err = document.getElementById('pfpErr');
  if (!btn || !file) return;
  btn.addEventListener('click', () => { err.textContent = ''; file.value = ''; file.click(); });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { err.textContent = 'images only'; return; }
    if (f.size > MAX_AVATAR_BYTES) { err.textContent = 'must be 4MB or smaller'; return; }
    btn.disabled = true;
    err.textContent = 'Uploading…';
    try {
      const url = await uploadAvatarFile(f);
      applyAvatarUrl(url);
      openFlameSheet();  // re-renders the You screen header with the new photo
    } catch (e) {
      err.textContent = e.message || 'upload failed';
      btn.disabled = false;
    }
  });
}
function openAvatarSheet() {
  toggleSheet(false);
  setSheetView({ type: 'avatar', venueId: null });
  const cur = localStorage.getItem('muan-avatar');
  setSheet(`<div id="avatarSheet" data-venue-detail hidden></div>
    <div class="s-title" style="text-align:center;">Choose your avatar</div>
    <div class="s-sub lao" style="text-align:center;">ເລືອກໂຕແທນຂອງເຈົ້າ</div>
    <div class="av-grid">` +
    AVATARS.map((_, i) =>
      `<button class="av-opt ${String(i)===cur?'sel':''}" data-av="${i}">${avatarSVG(i, 44)}</button>`
    ).join('') +
    `</div>
    <div style="text-align:center;font-size:11.5px;color:var(--mute);margin-top:14px;">your avatar joins check-ins, streaks & comments soon 🔥</div>
    <div class="btn-row"><button class="btn btn-back" data-back-flame style="flex:1;">Done</button></div>`);
  const sheet = document.getElementById('sheet');
  if (sheet) sheet.scrollTop = 0;
  document.querySelectorAll('.av-opt').forEach(b => b.addEventListener('click', () => {
    localStorage.setItem('muan-avatar', b.dataset.av);
    document.querySelectorAll('.av-opt').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
    refreshAvatarBtn();
  }));
  document.querySelector('[data-back-flame]')?.addEventListener('click', openFlameSheet);
}

function initGoogleSignIn(containerId) {
  if (!window.google?.accounts?.id) { setTimeout(() => initGoogleSignIn(containerId), 400); return; }
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: async (resp) => {
      try {
        const r = await fetch('/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: resp.credential }),
        });
        const data = await r.json();
        if (data.ok) openFlameSheet();
      } catch (e) {}
    },
  });
  const el = document.getElementById(containerId);
  if (el) google.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with' });
}

async function signOut() {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) {}
  openFlameSheet();
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

function miniFlame() {
  return `<svg class="mini-flame" width="18" height="22" viewBox="0 0 72 88" aria-hidden="true">
    <path class="mf-outer" d="M36 4 C31 21 15 29 15 47 C15 59 23 67 29 73 L36 88 L43 73 C49 67 57 59 57 47 C57 34 49 29 45 18 C43 27 38 29 36 26 C39 18 39 11 36 4 Z" fill="var(--flame)"/>
    <path class="mf-core" d="M36 34 C33 44 27 48 27 56 C27 64 31 69 36 69 C41 69 45 64 45 56 C45 49 41 45 38 38 C37 42 36 42 36 40 Z" fill="var(--gold)"/>
  </svg>`;
}

async function openFlameSheet() {
  toggleSheet(false);
  setSheetView({ type: 'flame', venueId: null });
  setMobileScreen('you');
  setSheet('<div class="s-sub" style="text-align:center;padding:30px 0;">Loading your flame…</div>');
  let me = null;
  try { me = await (await fetch('/api/me')).json(); } catch(e) {}
  if (!me || !me.ok) { setSheet('<div class="s-sub" style="text-align:center;padding:30px 0;">Could not load — try again.</div>'); return; }
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

// the normal flame-sheet content (calendar, flame, stage, embers, badges) —
// split out of openFlameSheet() so renderFlameIntro()'s "Got it" can hand
// off into it directly
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

  // "rhythm strip": one dot per day this month, filled on a check-in day —
  // a quick sense of pattern, not a centrepiece, so no day-of-week
  // alignment or numbers like the old full grid had
  const now = new Date();
  const yearMonth = me.month;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
  const checkinSet = new Set(me.checkin_days);
  let calDots = '<div class="fl-cal-dots">';
  for (let d=1; d<=daysInMonth; d++) {
    const iso = `${yearMonth}-${String(d).padStart(2,'0')}`;
    const lit = checkinSet.has(iso);
    const today = d === now.getDate();
    calDots += `<span class="fl-dot ${lit?'lit':''} ${today?'today':''}"></span>`;
  }
  calDots += '</div>';

  const monthName = now.toLocaleString('en',{month:'long'});
  const i = localStorage.getItem('muan-avatar');

  const venueCounts = me.venue_counts || {};
  const earnedIds = earnedItems(venueCounts).map(it => it.id);
  const noCheckins = me.total_checkins === 0;

  setSheet(`
    <div class="fl-wrap">

      <div class="fl-card fl-card-id">
        <div class="fl-id-row">
          <button type="button" class="fl-pfp" id="pfpBtn" aria-label="${me.avatar_url ? 'Change your photo' : 'Add a photo'}">
            ${me.avatar_url
              ? `<img src="${esc(cloudinaryAvatarUrl(me.avatar_url, 112))}" alt="">`
              : `<span class="fl-pfp-add">+</span>`}
          </button>
          <div class="fl-id-text">
            ${me.handle ? `<div class="fl-handle">@${esc(me.handle)}</div>` : ''}
            <div class="fl-id-summary">${me.venues_explored} places · ${me.total_checkins} check-ins</div>
          </div>
        </div>
        <input type="file" id="pfpFile" accept="image/*" hidden>
        <div class="fl-pfp-err" id="pfpErr"></div>

        <div class="fl-avatar-big">${i !== null ? avatarSVG(+i, 96, earnedIds) : '😊'}</div>
        <button class="fl-avatar-link" data-open-avatar>Change avatar</button>
      </div>

      <div class="fl-card fl-card-flame">
        <div class="fl-flame" data-heat="${me.heat_level}">
          ${flameHtml}
          <div class="fl-streak">${noCheckins ? '' : me.streak_months}</div>
        </div>
        <div class="fl-stage">${stageLabels[me.phai_stage]} · <span class="lao">${stageLo[me.phai_stage]}</span></div>
        <div class="fl-sub">${noCheckins ? 'light your first flame — check in anywhere' : esc(heatLines[me.heat_level] || '')}</div>
        ${me.embers_total > 0 ? `<div class="fl-embers"><b>${me.embers_total}</b> embers</div>` : ''}
        <div class="fl-month">${monthName}</div>
        ${calDots}
      </div>

      ${me.badges?.length ? `
      <div class="fl-card fl-card-badges">
        <div class="fl-badges">
          ${me.badges.map(b => `<div class="fl-badge" title="${esc(b.description||'')}">
             <span class="fl-badge-ico">${b.icon}</span>
             <span class="fl-badge-name">${esc(b.name)}</span>
           </div>`).join('')}
        </div>
      </div>` : ''}

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
  document.querySelector('[data-open-avatar]')?.addEventListener('click', openAvatarSheet);
  document.querySelector('[data-sign-out]')?.addEventListener('click', signOut);
  wirePfpUpload();
  document.querySelector('[data-list-venue]')?.addEventListener('click', openVenueSubmitForm);
  document.querySelectorAll('[data-manage-venue]').forEach(el => el.addEventListener('click', () => {
    const v = myVenuesResult.venues.find(mv => mv.id === el.dataset.manageVenue);
    if (v) openVenueEditor(v);
  }));
  document.querySelector('[data-admin-pending]')?.addEventListener('click', () => openAdminPendingSheet(pendingVenuesResult.venues));
  // both the "couldn't load your venues" and "pending venues couldn't load"
  // states retry the same way: re-run the whole fetch+render cycle, since
  // both come from the same Promise.all in openFlameSheet()
  document.querySelectorAll('[data-retry-flame]').forEach(el => el.addEventListener('click', openFlameSheet));
}

/* ---------- venue owner dashboard: edit form ---------- */
// server-side whitelist/validation lives in functions/api/venues/[id].js —
// this form only needs to produce values in the shape that endpoint expects
// and show its errors back inline; it is not the source of truth for what's
// allowed to be written.
const ED_DAY_ORDER = ['mon','tue','wed','thu','fri','sat','sun'];
const ED_DAY_LABELS = { mon:'Mon', tue:'Tue', wed:'Wed', thu:'Thu', fri:'Fri', sat:'Sat', sun:'Sun' };
const MAX_SIG_ITEMS = 3;
const MAX_SIG_NAME = 60;
const MAX_SIG_NOTE = 80;
const MAX_PHOTOS = 8;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

// stored "HH:MM-HH:MM" (close hour may run to 27 for past-midnight, see
// data/venues.json's _schema_notes) -> plain 24h clock for two
// <input type="time"> elements, which can't represent hours past 23:59
function edSplitHourRange(str) {
  if (!str) return null;
  const [a, b] = str.split('-');
  const mod = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return String(h % 24).padStart(2,'0') + ':' + String(m).padStart(2,'0');
  };
  return { open: mod(a), close: mod(b) };
}

// the reverse: two plain-clock times back into the stored convention — if
// close reads earlier than open, it's assumed to run past midnight (matches
// how every overnight venue in the data is already authored, e.g. baron's
// "20:00-27:00"), so there is no separate "closes after midnight" toggle
function edBuildHourRange(openStr, closeStr) {
  const toMins = s => { const [h,m] = s.split(':').map(Number); return h*60+m; };
  const openMins = toMins(openStr);
  let closeMins = toMins(closeStr);
  if (closeMins <= openMins) closeMins += 1440;
  const fmt = mins => String(Math.floor(mins/60)).padStart(2,'0') + ':' + String(mins%60).padStart(2,'0');
  return `${openStr}-${fmt(closeMins)}`;
}

// "0205236087" / "020 5236 6087" / already "+8562052366087" -> the +856
// form for storage, keeping whatever the owner typed as phone_display
// verbatim (CLAUDE.md: "phone_display is how locals write it")
function edDeriveLaoPhone(raw) {
  const trimmed = (raw || '').trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return { phone: '', phone_display: '' };
  let national = digits;
  if (national.startsWith('856')) national = national.slice(3);
  else if (national.startsWith('0')) national = national.slice(1);
  return { phone: '+856' + national, phone_display: trimmed };
}

// three fixed rows regardless of how many items the venue currently has —
// clearing a row's name is how an owner deletes that item (readState()
// below drops any row with a blank name), matching the server's
// validateSignature() in functions/api/venues/[id].js
function edSigRowHtml(idx, item) {
  return `
    <div class="ed-sig-row" data-sig-idx="${idx}">
      <input type="text" class="ed-input ed-sig-name" placeholder="Item name" maxlength="${MAX_SIG_NAME}" value="${esc(item.name || '')}">
      <div class="ed-sig-sub">
        <input type="number" inputmode="numeric" class="ed-input ed-sig-price" placeholder="Price (kip)" min="0" step="1000" value="${item.price != null ? item.price : ''}">
        <input type="text" class="ed-input ed-sig-note" placeholder="Note (optional)" maxlength="${MAX_SIG_NOTE}" value="${esc(item.note || '')}">
      </div>
    </div>`;
}

function edPhotoRowHtml(url, idx, total) {
  const isMain = idx === 0;
  return `
    <div class="ed-photo${isMain ? ' ed-photo-main' : ''}" data-photo-url="${esc(url)}" draggable="true">
      <img src="${esc(cloudinaryUrl(url, 200))}" alt="">
      ${isMain ? '<div class="ed-photo-main-label">Main photo — shown on cards and the map</div>' : ''}
      <div class="ed-photo-actions">
        <button type="button" class="ed-photo-up" ${idx === 0 ? 'disabled' : ''} aria-label="Move earlier">↑</button>
        <button type="button" class="ed-photo-down" ${idx === total - 1 ? 'disabled' : ''} aria-label="Move later">↓</button>
        ${!isMain ? '<button type="button" class="ed-photo-main-btn" aria-label="Make main photo" title="Make main">★</button>' : ''}
        <button type="button" class="ed-photo-remove" aria-label="Remove">✕</button>
      </div>
      <div class="ed-photo-confirm" hidden>
        <span>Remove this photo?</span>
        <button type="button" class="ed-photo-confirm-yes">Remove</button>
        <button type="button" class="ed-photo-confirm-no">Cancel</button>
      </div>
    </div>`;
}

function edRenderPhotos(container, photos, onChange) {
  container.innerHTML = photos.length
    ? photos.map((p, i) => edPhotoRowHtml(p, i, photos.length)).join('')
    : '<div class="ed-photos-empty">No photos yet</div>';

  // desktop drag-to-reorder, kept alongside the up/down arrows rather than
  // replacing them: arrows are the baseline (keyboard-accessible, and the
  // only one that works on mobile — native HTML5 drag doesn't), this is an
  // extra affordance for anyone who reaches for it with a mouse
  let dragFrom = null;

  container.querySelectorAll('.ed-photo').forEach((row, i) => {
    row.querySelector('.ed-photo-up')?.addEventListener('click', () => {
      if (i === 0) return;
      [photos[i-1], photos[i]] = [photos[i], photos[i-1]];
      edRenderPhotos(container, photos, onChange);
      onChange();
    });
    row.querySelector('.ed-photo-down')?.addEventListener('click', () => {
      if (i === photos.length - 1) return;
      [photos[i], photos[i+1]] = [photos[i+1], photos[i]];
      edRenderPhotos(container, photos, onChange);
      onChange();
    });
    // the action people actually want — one tap instead of dragging (or
    // walking a photo to the front one ↑ at a time)
    row.querySelector('.ed-photo-main-btn')?.addEventListener('click', () => {
      const [moved] = photos.splice(i, 1);
      photos.unshift(moved);
      edRenderPhotos(container, photos, onChange);
      onChange();
    });

    // remove is a two-step confirm, not one tap — this used to delete
    // whatever an owner just uploaded on a single misclick
    const confirmBox = row.querySelector('.ed-photo-confirm');
    row.querySelector('.ed-photo-remove')?.addEventListener('click', () => { confirmBox.hidden = false; });
    row.querySelector('.ed-photo-confirm-no')?.addEventListener('click', () => { confirmBox.hidden = true; });
    row.querySelector('.ed-photo-confirm-yes')?.addEventListener('click', () => {
      photos.splice(i, 1);
      edRenderPhotos(container, photos, onChange);
      onChange();
    });

    // tap the photo itself (not a button) to view it full size
    row.querySelector('img')?.addEventListener('click', () => openLightbox(photos, i));

    row.addEventListener('dragstart', (e) => {
      dragFrom = i;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      dragFrom = null;
      container.querySelectorAll('.ed-photo').forEach(r => r.classList.remove('dragging', 'drag-over'));
    });
    row.addEventListener('dragover', (e) => {
      if (dragFrom === null || dragFrom === i) return;
      e.preventDefault();
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (e) => {
      if (dragFrom === null || dragFrom === i) return;
      e.preventDefault();
      const [moved] = photos.splice(dragFrom, 1);
      photos.splice(i, 0, moved);
      edRenderPhotos(container, photos, onChange);
      onChange();
    });
  });
}

/* ---------- owner-form field labels (Lao + English) ---------- */
// Lao labels on the two owner-facing forms only (List your venue / Edit
// venue) — the rest of the app stays as-is; CLAUDE.md's "Lao-first, English
// supports" already governs the browsing UI's bilingual headers, this is a
// separate, narrower fix for a specific evidenced problem: the first real
// owner submission (Sunin) came in with short/description both null, "."
// typed into parking to get past it, and her own Facebook link pasted into
// the Website field too — she said afterwards she didn't know what "short
// name" or "tagline" meant.
//
// TODO(kar): every `lo` string below is my best-attempt translation, not
// checked by a native Lao speaker — please review this whole block in one
// pass before any of it ships. Two entries (`website`, and the "optional"
// marker text used across every optional field) were given to me verbatim
// and don't need re-checking; everything else does.
const OWNER_FIELD_LABELS = {
  name:        { lo: 'ຊື່ຮ້ານ',        en: 'Name' },
  short_name:  { lo: 'ຊື່ຫຍໍ້',         en: 'Short name — shown on cards instead of the full name' },
  name_lo:     { lo: 'ຊື່ພາສາລາວ',      en: 'Lao name' },
  type:        { lo: 'ປະເພດ',          en: 'Type' },
  area:        { lo: 'ເຂດ',            en: 'Area' },
  short:       { lo: 'ຄຳຂວັນສັ້ນ',      en: 'Short tagline — one line shown on your card' },
  description: { lo: 'ຄຳອະທິບາຍ',       en: 'Description' },
  signature:   { lo: 'ເມນູເດັ່ນ',       en: 'Signature items — up to 3, shown as "Try this"' },
  photos:      { lo: 'ຮູບພາບ',         en: 'Photos' },
  hours:       { lo: 'ໂມງເປີດ-ປິດ',     en: 'Hours' },
  phone:       { lo: 'ເບີໂທ',          en: 'Phone' },
  parking:     { lo: 'ບ່ອນຈອດລົດ',      en: 'Parking note' },
  facebook:    { lo: 'ລິ້ງເຟສບຸກ',      en: 'Facebook link' },
  website:     { lo: 'ເວັບໄຊ (ບໍ່ແມ່ນ Facebook)', en: 'Website — not Facebook' },
  maps_url:    { lo: 'ລິ້ງ Google Maps', en: 'Google Maps link' },
};

// mirrors the server's actual requirement — name, type, area, maps_url
// (see REQUIRED_SIMPLE_FIELDS in functions/api/_venue-validation.js and the
// maps_url check in functions/api/venues.js's handlePost). Every other
// field renders the optional marker instead — the concrete fix for the
// "typed '.' into parking to get past it" problem, since nothing on the
// old form told her she could just leave it blank.
const REQUIRED_FIELD_KEYS = new Set(['name', 'type', 'area', 'maps_url']);

function edLabelHtml(key, forId) {
  const l = OWNER_FIELD_LABELS[key];
  const marker = REQUIRED_FIELD_KEYS.has(key)
    ? '<span class="ed-label-req">ຈຳເປັນ / required</span>'
    : '<span class="ed-label-opt">ບໍ່ຈຳເປັນ / optional</span>';
  return `<label class="ed-label"${forId ? ` for="${forId}"` : ''}>
      <span class="ed-label-lo lao">${l.lo}</span>
      <span class="ed-label-en">${l.en}</span>
      ${marker}
    </label>`;
}

// the first real submission (Sunin) had her Facebook link pasted into
// Website too — nudge, don't block: names what's wrong and offers a
// one-click move, but only when it's safe (the Facebook field is still
// empty), so a move can never silently overwrite a link already there.
// Shared by both owner forms (prefix 'sub'/'ed') via matching element ids.
function wireFacebookWebsiteGuard(root, prefix) {
  const site = root.querySelector(`#${prefix}Website`);
  const fb = root.querySelector(`#${prefix}Facebook`);
  const warn = root.querySelector(`#${prefix}WebsiteWarn`);
  const moveBtn = root.querySelector(`#${prefix}WebsiteMove`);
  if (!site || !fb || !warn) return;
  const isFacebookUrl = v => /facebook\.com|fb\.me/i.test(v);
  const check = () => {
    warn.hidden = !isFacebookUrl(site.value);
    if (moveBtn) moveBtn.hidden = !!fb.value.trim();
  };
  site.addEventListener('input', check);
  fb.addEventListener('input', check);
  moveBtn?.addEventListener('click', () => {
    fb.value = site.value.trim();
    site.value = '';
    site.dispatchEvent(new Event('input'));
    fb.dispatchEvent(new Event('input'));
  });
  check();
}

/* ---------- "List your venue" — owner submission ---------- */
// same field set as openVenueEditor() below (reuses edSigRowHtml, the hour-
// row markup, edDeriveLaoPhone/edBuildHourRange), minus Photos — there's no
// venue id yet for Cloudinary's folder scoping (see upload-signature.js) —
// plus a required Google Maps link, since that's the only lead Kar has to
// go place the pin from. No lat/lng input exists here or anywhere else;
// POST /api/venues always inserts pin_status 'pending' with lat/lng NULL.
// On success this hands off straight into openVenueEditor() for the venue
// it just created, since photos and further edits happen there.
function openVenueSubmitForm() {
  toggleSheet(false);
  setSheetView({ type: 'venue-submit', venueId: null });

  const hoursRowsHtml = ED_DAY_ORDER.map(day => `
    <div class="ed-hrow" data-day="${day}">
      <label class="ed-hrow-toggle">
        <input type="checkbox" class="ed-hopen">
        <span>${ED_DAY_LABELS[day]}</span>
      </label>
      <div class="ed-hrow-times" hidden>
        <input type="time" class="ed-hfrom" value="17:00">
        <span class="ed-hdash">–</span>
        <input type="time" class="ed-hto" value="23:00">
      </div>
    </div>`).join('');

  const sigRowsHtml = [0, 1, 2].map(i => edSigRowHtml(i, {})).join('');

  setSheet(`
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <button class="sheet-x" data-back-manage aria-label="Back">←</button>
      <div class="s-title" style="flex:1;text-align:center;">List your venue</div>
      <span style="width:32px;flex-shrink:0;"></span>
    </div>
    <div class="ed-hint" style="margin:4px 0 10px;">
      This adds your place to the list right away. It won't show a pin on the map until we confirm the location from your Maps link below.
    </div>

    <div class="ed-field">
      ${edLabelHtml('name', 'subName')}
      <input type="text" class="ed-input" id="subName" maxlength="100">
      <div class="ed-err" data-err-for="name"></div>
    </div>
    <div class="ed-field">
      ${edLabelHtml('short_name', 'subShortName')}
      <input type="text" class="ed-input" id="subShortName" maxlength="40" placeholder="Sathiti">
      <div class="ed-err" data-err-for="short_name"></div>
    </div>
    <div class="ed-field">
      ${edLabelHtml('name_lo', 'subNameLo')}
      <input type="text" class="ed-input lao" id="subNameLo" maxlength="60">
      <div class="ed-err" data-err-for="name_lo"></div>
    </div>

    <div class="ed-field">
      ${edLabelHtml('type', null)}
      <div class="seg ed-type-seg" id="subTypeSeg">
        <button type="button" class="seg-btn ed-type-btn on" data-type="bar">Bar</button>
        <button type="button" class="seg-btn ed-type-btn" data-type="cafe">Café</button>
        <button type="button" class="seg-btn ed-type-btn" data-type="venue">Venue</button>
      </div>
      <div class="ed-err" data-err-for="type"></div>
    </div>

    <div class="ed-field">
      ${edLabelHtml('area', 'subArea')}
      <input type="text" class="ed-input" id="subArea" maxlength="80" placeholder="Rue Hengboun, Ban Anou">
      <div class="ed-err" data-err-for="area"></div>
    </div>

    <div class="ed-field">
      ${edLabelHtml('short', 'subShort')}
      <input type="text" class="ed-input" id="subShort" maxlength="120" placeholder="Belgian beer bar on the riverfront, big bottle list">
      <div class="ed-err" data-err-for="short"></div>
    </div>

    <div class="ed-field">
      ${edLabelHtml('description', 'subDescription')}
      <textarea class="ed-textarea" id="subDescription" maxlength="500" rows="4" placeholder="Specialty coffee house on Hengboun run by a competition barista — Champion of the Savannakhet Aeropress 2025 and third in the Vientiane Moka Pot Battle."></textarea>
      <div class="ed-charcount"><span id="subDescCount">0</span>/500</div>
      <div class="ed-err" data-err-for="description"></div>
    </div>

    <div class="ed-field">
      ${edLabelHtml('signature', null)}
      <div class="ed-sig-list" id="subSigList">${sigRowsHtml}</div>
      <div class="ed-err" data-err-for="signature"></div>
    </div>

    <div class="ed-field">
      ${edLabelHtml('hours', null)}
      <div class="ed-hours" id="subHours">${hoursRowsHtml}</div>
      <div class="ed-err" data-err-for="hours"></div>
    </div>

    <div class="ed-field">
      ${edLabelHtml('phone', 'subPhone')}
      <input type="tel" class="ed-input" id="subPhone" placeholder="020 5236 6087">
      <div class="ed-hint" id="subPhonePreview"></div>
      <div class="ed-err" data-err-for="contact"></div>
    </div>

    <div class="ed-field">
      ${edLabelHtml('parking', 'subParkingNote')}
      <input type="text" class="ed-input" id="subParkingNote" maxlength="60" placeholder="e.g. free lot behind the building">
      <div class="ed-err" data-err-for="parking"></div>
    </div>

    <div class="ed-field">
      ${edLabelHtml('facebook', 'subFacebook')}
      <input type="url" class="ed-input" id="subFacebook" placeholder="https://facebook.com/...">
      <div class="ed-err" data-err-for="links"></div>
    </div>
    <div class="ed-field">
      ${edLabelHtml('website', 'subWebsite')}
      <input type="url" class="ed-input" id="subWebsite" placeholder="https://...">
      <div class="ed-fb-warn" id="subWebsiteWarn" hidden>
        <span>That looks like a Facebook link — Facebook goes in the field above.</span>
        <button type="button" class="ed-fb-warn-move" id="subWebsiteMove">Move it</button>
      </div>
    </div>
    <div class="ed-field">
      ${edLabelHtml('maps_url', 'subMapsUrl')}
      <input type="url" class="ed-input" id="subMapsUrl" placeholder="https://maps.google.com/...">
      <div class="ed-hint">This is how we place your pin — there's no other way to set it yet.</div>
      <div class="ed-err" data-err-for="maps_url"></div>
    </div>

    <div class="ed-save-note" id="subSaveNote" hidden></div>
    <div class="btn-row"><button class="btn btn-go" id="subSaveBtn" style="flex:1;">Submit</button></div>
    <div class="ed-hint" style="text-align:center;">You'll add photos in the next step</div>
  `);

  const sheet = document.getElementById('sheet');
  if (sheet) sheet.scrollTop = 0;
  document.querySelector('[data-back-manage]')?.addEventListener('click', openFlameSheet);

  wireVenueSubmitForm();
}

function wireVenueSubmitForm() {
  const root = document.getElementById('sheetInner');
  const saveBtn = document.getElementById('subSaveBtn');
  const saveNote = document.getElementById('subSaveNote');

  wireFacebookWebsiteGuard(root, 'sub');

  root.querySelectorAll('.ed-type-btn').forEach(btn => btn.addEventListener('click', () => {
    root.querySelectorAll('.ed-type-btn').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
  }));

  root.querySelectorAll('.ed-hrow').forEach(row => {
    const toggle = row.querySelector('.ed-hopen');
    const times = row.querySelector('.ed-hrow-times');
    toggle.addEventListener('change', () => { times.hidden = !toggle.checked; });
  });

  root.querySelector('#subPhone').addEventListener('input', (e) => {
    const { phone } = edDeriveLaoPhone(e.target.value);
    document.getElementById('subPhonePreview').textContent = phone ? `Saves as ${phone}` : '';
  });

  root.querySelector('#subDescription').addEventListener('input', (e) => {
    document.getElementById('subDescCount').textContent = e.target.value.length;
  });

  const clearErrors = () => root.querySelectorAll('.ed-err').forEach(e => e.textContent = '');

  const readState = () => {
    const type = root.querySelector('.ed-type-btn.on')?.dataset.type || 'bar';
    const hours = {};
    root.querySelectorAll('.ed-hrow').forEach(row => {
      const day = row.dataset.day;
      const open = row.querySelector('.ed-hopen').checked;
      if (!open) { hours[day] = null; return; }
      const from = row.querySelector('.ed-hfrom').value;
      const to = row.querySelector('.ed-hto').value;
      hours[day] = (from && to) ? edBuildHourRange(from, to) : null;
    });
    const { phone, phone_display } = edDeriveLaoPhone(root.querySelector('#subPhone').value);
    const parkingNote = root.querySelector('#subParkingNote').value.trim();
    const signature = [];
    root.querySelectorAll('.ed-sig-row').forEach(row => {
      const name = row.querySelector('.ed-sig-name').value.trim();
      if (!name) return;
      const priceRaw = row.querySelector('.ed-sig-price').value.trim();
      const note = row.querySelector('.ed-sig-note').value.trim();
      const item = { name };
      if (priceRaw !== '') item.price = Math.round(Number(priceRaw));
      if (note) item.note = note;
      signature.push(item);
    });
    return {
      name: root.querySelector('#subName').value.trim(),
      short_name: root.querySelector('#subShortName').value.trim(),
      name_lo: root.querySelector('#subNameLo').value.trim(),
      type,
      area: root.querySelector('#subArea').value.trim(),
      short: root.querySelector('#subShort').value.trim(),
      description: root.querySelector('#subDescription').value,
      hours,
      contact: phone ? { phone, phone_display } : null,
      parking: parkingNote ? { note: parkingNote, source: 'venue told us' } : null,
      links: {
        facebook: root.querySelector('#subFacebook').value.trim(),
        website: root.querySelector('#subWebsite').value.trim(),
      },
      maps_url: root.querySelector('#subMapsUrl').value.trim(),
      signature: signature.length ? signature : null,
    };
  };

  saveBtn.addEventListener('click', async () => {
    clearErrors();
    saveNote.hidden = true;
    saveBtn.disabled = true;
    saveBtn.innerHTML = `${loadingRing(16)}Submitting…`;
    const body = readState();
    try {
      const res = await fetch('/api/venues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!data) throw new Error('bad response');

      if (!data.ok) {
        if (data.errors) {
          for (const [field, msg] of Object.entries(data.errors)) {
            const el = root.querySelector(`[data-err-for="${field}"]`);
            if (el) el.textContent = msg;
          }
        }
        saveNote.hidden = false;
        saveNote.className = 'ed-save-note ed-save-note-error';
        saveNote.textContent = data.errors ? 'Fix the highlighted fields and try again.' : (data.error || 'Could not submit — try again.');
        saveBtn.textContent = 'Submit';
        saveBtn.disabled = false;
        return;
      }

      // straight into the normal dashboard editor — photos and any further
      // edits happen there from here on
      openVenueEditor(data.venue, { justSubmitted: true });
    } catch (e) {
      saveNote.hidden = false;
      saveNote.className = 'ed-save-note ed-save-note-error';
      saveNote.textContent = 'Connection error — try again.';
      saveBtn.textContent = 'Submit';
      saveBtn.disabled = false;
    }
  });
}

function openVenueEditor(venue, opts = {}) {
  toggleSheet(false);
  setSheetView({ type: 'venue-edit', venueId: venue.id });

  const hours = venue.hours || {};
  const contact = venue.contact || {};
  const parking = venue.parking || {};
  const links = venue.links || {};
  const sig = venue.signature || [];
  const sigRowsHtml = [0, 1, 2].map(i => edSigRowHtml(i, sig[i] || {})).join('');

  const hoursRowsHtml = ED_DAY_ORDER.map(day => {
    const range = edSplitHourRange(hours[day]);
    const isOpen = !!range;
    return `
      <div class="ed-hrow" data-day="${day}">
        <label class="ed-hrow-toggle">
          <input type="checkbox" class="ed-hopen" ${isOpen ? 'checked' : ''}>
          <span>${ED_DAY_LABELS[day]}</span>
        </label>
        <div class="ed-hrow-times" ${isOpen ? '' : 'hidden'}>
          <input type="time" class="ed-hfrom" value="${range ? range.open : '17:00'}">
          <span class="ed-hdash">–</span>
          <input type="time" class="ed-hto" value="${range ? range.close : '23:00'}">
        </div>
      </div>`;
  }).join('');

  const descLen = (venue.description || '').length;

  setSheet(`
    <span data-venue-detail hidden></span>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <button class="sheet-x" data-back-manage aria-label="Back">←</button>
      <div class="s-title" style="flex:1;text-align:center;">Edit venue</div>
      <span style="width:32px;flex-shrink:0;"></span>
    </div>

    ${venue.pin_status === 'rejected' ? `
    <div class="ed-rejected-note">
      <b>Not approved.</b> ${esc(venue.rejection_reason || '')}
      <div>Fix what's above and it'll be reviewed again.</div>
    </div>` : ''}

    ${opts.justSubmitted && !venue.short && !venue.description ? `
    <div class="ed-empty-note" id="edEmptyNote">
      <span>Your venue will look empty without a short tagline or description below — add them when you can.</span>
      <button type="button" class="ed-empty-note-close" id="edEmptyNoteClose" aria-label="Dismiss">×</button>
    </div>` : ''}

    <div class="ed-field">
      ${edLabelHtml('name', 'edName')}
      <input type="text" class="ed-input" id="edName" value="${esc(venue.name)}" maxlength="100">
      <div class="ed-err" data-err-for="name"></div>
    </div>
    <div class="ed-field">
      ${edLabelHtml('short_name', 'edShortName')}
      <input type="text" class="ed-input" id="edShortName" value="${esc(venue.short_name || '')}" maxlength="40" placeholder="Sathiti">
      <div class="ed-err" data-err-for="short_name"></div>
    </div>
    <div class="ed-field">
      ${edLabelHtml('name_lo', 'edNameLo')}
      <input type="text" class="ed-input lao" id="edNameLo" value="${esc(venue.name_lo || '')}" maxlength="60">
      <div class="ed-err" data-err-for="name_lo"></div>
    </div>

    <div class="ed-field">
      ${edLabelHtml('type', null)}
      <div class="seg ed-type-seg" id="edTypeSeg">
        <button type="button" class="seg-btn ed-type-btn ${venue.type==='bar'?'on':''}" data-type="bar">Bar</button>
        <button type="button" class="seg-btn ed-type-btn ${venue.type==='cafe'?'on':''}" data-type="cafe">Café</button>
        <button type="button" class="seg-btn ed-type-btn ${venue.type==='venue'?'on':''}" data-type="venue">Venue</button>
      </div>
      <div class="ed-err" data-err-for="type"></div>
    </div>

    <div class="ed-field">
      ${edLabelHtml('area', 'edArea')}
      <input type="text" class="ed-input" id="edArea" value="${esc(venue.area || '')}" maxlength="80" placeholder="Rue Hengboun, Ban Anou">
      <div class="ed-err" data-err-for="area"></div>
    </div>

    <div class="ed-field">
      ${edLabelHtml('short', 'edShort')}
      <input type="text" class="ed-input" id="edShort" value="${esc(venue.short || '')}" maxlength="120" placeholder="Belgian beer bar on the riverfront, big bottle list">
      <div class="ed-err" data-err-for="short"></div>
    </div>

    <div class="ed-field">
      ${edLabelHtml('description', 'edDescription')}
      <textarea class="ed-textarea" id="edDescription" maxlength="500" rows="4" placeholder="Specialty coffee house on Hengboun run by a competition barista — Champion of the Savannakhet Aeropress 2025 and third in the Vientiane Moka Pot Battle.">${esc(venue.description || '')}</textarea>
      <div class="ed-charcount"><span id="edDescCount">${descLen}</span>/500</div>
      <div class="ed-err" data-err-for="description"></div>
    </div>

    <div class="ed-field">
      ${edLabelHtml('signature', null)}
      <div class="ed-sig-list" id="edSigList">${sigRowsHtml}</div>
      <div class="ed-err" data-err-for="signature"></div>
    </div>

    <div class="ed-field" id="edPhotoField">
      ${edLabelHtml('photos', null)}
      <div class="ed-photo-nudge" id="edPhotoNudge" hidden>
        <span>Add a few photos so people know what to expect</span>
        <button type="button" class="ed-photo-nudge-close" id="edPhotoNudgeClose" aria-label="Dismiss">×</button>
      </div>
      <div class="ed-photos" id="edPhotos"></div>
      <input type="file" id="edPhotoFile" accept="image/*" multiple hidden>
      <button type="button" class="ed-photo-add" id="edPhotoAddBtn">+ Add photo</button>
      <div class="ed-photo-progress" id="edPhotoProgress" hidden>
        <div class="ed-photo-progress-track"><div class="ed-photo-progress-bar" id="edPhotoProgressBar"></div></div>
        <div class="ed-photo-progress-label" id="edPhotoProgressLabel">Uploading… ${uploadPctHtml(0)}</div>
      </div>
      <div class="ed-err" data-err-for="upload"></div>
    </div>

    <div class="ed-field">
      ${edLabelHtml('hours', null)}
      <div class="ed-hours" id="edHours">${hoursRowsHtml}</div>
      <div class="ed-err" data-err-for="hours"></div>
    </div>

    <div class="ed-field">
      ${edLabelHtml('phone', 'edPhone')}
      <input type="tel" class="ed-input" id="edPhone" value="${esc(contact.phone_display || '')}" placeholder="020 5236 6087">
      <div class="ed-hint" id="edPhonePreview">${contact.phone ? 'Saves as ' + esc(contact.phone) : ''}</div>
      <div class="ed-err" data-err-for="contact"></div>
    </div>

    <div class="ed-field">
      ${edLabelHtml('parking', 'edParkingNote')}
      <input type="text" class="ed-input" id="edParkingNote" value="${esc(parking.note || '')}" maxlength="60" placeholder="e.g. free lot behind the building">
      <div class="ed-err" data-err-for="parking"></div>
    </div>

    <div class="ed-field">
      ${edLabelHtml('facebook', 'edFacebook')}
      <input type="url" class="ed-input" id="edFacebook" value="${esc(links.facebook || '')}" placeholder="https://facebook.com/...">
      <div class="ed-err" data-err-for="links"></div>
    </div>
    <div class="ed-field">
      ${edLabelHtml('website', 'edWebsite')}
      <input type="url" class="ed-input" id="edWebsite" value="${esc(links.website || '')}" placeholder="https://...">
      <div class="ed-fb-warn" id="edWebsiteWarn" hidden>
        <span>That looks like a Facebook link — Facebook goes in the field above.</span>
        <button type="button" class="ed-fb-warn-move" id="edWebsiteMove">Move it</button>
      </div>
    </div>
    <div class="ed-field">
      ${edLabelHtml('maps_url', 'edMapsUrl')}
      <input type="url" class="ed-input" id="edMapsUrl" value="${esc(links.maps || '')}" placeholder="https://maps.google.com/...">
      <div class="ed-hint">Changing this asks us to double-check your map pin.</div>
      <div class="ed-err" data-err-for="maps_url"></div>
    </div>

    <div class="ed-save-note" id="edSaveNote" hidden></div>
    <div class="btn-row"><button class="btn btn-go" id="edSaveBtn" disabled style="flex:1;">Save</button></div>
  `);

  const sheet = document.getElementById('sheet');
  if (sheet) sheet.scrollTop = 0;
  document.querySelector('[data-back-manage]')?.addEventListener('click', openFlameSheet);

  wireVenueEditor(venue, opts);
}

function wireVenueEditor(venue, opts = {}) {
  const root = document.getElementById('sheetInner');
  const saveBtn = document.getElementById('edSaveBtn');
  const saveNote = document.getElementById('edSaveNote');
  let photosState = (venue.photos || []).slice();

  wireFacebookWebsiteGuard(root, 'ed');

  const readState = () => {
    const type = root.querySelector('.ed-type-btn.on')?.dataset.type || venue.type;
    const hours = {};
    root.querySelectorAll('.ed-hrow').forEach(row => {
      const day = row.dataset.day;
      const open = row.querySelector('.ed-hopen').checked;
      if (!open) { hours[day] = null; return; }
      const from = row.querySelector('.ed-hfrom').value;
      const to = row.querySelector('.ed-hto').value;
      hours[day] = (from && to) ? edBuildHourRange(from, to) : null;
    });
    const { phone, phone_display } = edDeriveLaoPhone(root.querySelector('#edPhone').value);
    const parkingNote = root.querySelector('#edParkingNote').value.trim();
    return {
      name: root.querySelector('#edName').value.trim(),
      short_name: root.querySelector('#edShortName').value.trim(),
      name_lo: root.querySelector('#edNameLo').value.trim(),
      type,
      area: root.querySelector('#edArea').value.trim(),
      short: root.querySelector('#edShort').value.trim(),
      description: root.querySelector('#edDescription').value,
      hours,
      contact: phone ? { phone, phone_display } : null,
      parking: parkingNote ? { note: parkingNote, source: 'venue told us' } : null,
      links: {
        facebook: root.querySelector('#edFacebook').value.trim(),
        website: root.querySelector('#edWebsite').value.trim(),
      },
      maps_url: root.querySelector('#edMapsUrl').value.trim(),
      photos: photosState.slice(),
      signature: readSignature(),
    };
  };

  // blank-name rows are dropped, same rule as the server's
  // validateSignature() — clearing a row's name is how an owner deletes
  // that item, not a separate "delete" control
  function readSignature() {
    const items = [];
    root.querySelectorAll('.ed-sig-row').forEach(row => {
      const name = row.querySelector('.ed-sig-name').value.trim();
      if (!name) return;
      const priceRaw = row.querySelector('.ed-sig-price').value.trim();
      const note = row.querySelector('.ed-sig-note').value.trim();
      const item = { name };
      if (priceRaw !== '') item.price = Math.round(Number(priceRaw));
      if (note) item.note = note;
      items.push(item);
    });
    return items.length ? items : null;
  }

  // baseline snapshot, taken from the just-rendered (unedited) DOM — see
  // edSplitHourRange()/edDeriveLaoPhone()'s comments for why this round-
  // trips to exactly the stored values with zero edits made. Kept as a
  // parsed object (not a JSON string) so a standalone photo upload (see
  // wireVenuePhotoUpload() below) can re-baseline just the photos field
  // without disturbing the dirty/clean state of any other in-progress edit.
  let baselineState = readState();

  const clearErrors = () => root.querySelectorAll('.ed-err').forEach(e => e.textContent = '');

  const refreshDirty = () => {
    saveBtn.disabled = JSON.stringify(readState()) === JSON.stringify(baselineState);
  };

  edRenderPhotos(document.getElementById('edPhotos'), photosState, refreshDirty);

  // owners land here straight from a successful submission, and the submit
  // form has nowhere to add photos yet (no venue id to attach them to) — so
  // the first real owner submission (Sunin) went out with zero photos and
  // no indication that a next step existed. Draw the eye to it once, here.
  if (opts.justSubmitted && photosState.length === 0) {
    const nudge = document.getElementById('edPhotoNudge');
    if (nudge) {
      nudge.hidden = false;
      document.getElementById('edPhotoNudgeClose')?.addEventListener('click', () => { nudge.hidden = true; });
    }
    const photoField = document.getElementById('edPhotoField');
    if (photoField) {
      photoField.scrollIntoView({ behavior: 'smooth', block: 'center' });
      photoField.classList.add('ed-photo-highlight');
      setTimeout(() => photoField.classList.remove('ed-photo-highlight'), 1600);
    }
  }

  document.getElementById('edEmptyNoteClose')?.addEventListener('click', () => {
    document.getElementById('edEmptyNote').hidden = true;
  });

  root.querySelectorAll('.ed-type-btn').forEach(btn => btn.addEventListener('click', () => {
    root.querySelectorAll('.ed-type-btn').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    refreshDirty();
  }));

  root.querySelectorAll('.ed-hrow').forEach(row => {
    const toggle = row.querySelector('.ed-hopen');
    const times = row.querySelector('.ed-hrow-times');
    toggle.addEventListener('change', () => {
      times.hidden = !toggle.checked;
      refreshDirty();
    });
    row.querySelector('.ed-hfrom').addEventListener('change', refreshDirty);
    row.querySelector('.ed-hto').addEventListener('change', refreshDirty);
  });

  root.querySelector('#edPhone').addEventListener('input', (e) => {
    const { phone } = edDeriveLaoPhone(e.target.value);
    const preview = document.getElementById('edPhonePreview');
    preview.textContent = phone ? `Saves as ${phone}` : '';
    refreshDirty();
  });

  root.querySelector('#edDescription').addEventListener('input', (e) => {
    document.getElementById('edDescCount').textContent = e.target.value.length;
    refreshDirty();
  });

  root.querySelectorAll('#edName, #edShortName, #edNameLo, #edArea, #edShort, #edParkingNote, #edFacebook, #edWebsite, #edMapsUrl')
    .forEach(el => el.addEventListener('input', refreshDirty));

  root.querySelectorAll('.ed-sig-name, .ed-sig-price, .ed-sig-note')
    .forEach(el => el.addEventListener('input', refreshDirty));

  wireVenuePhotoUpload(venue, root, photosState, () => {
    edRenderPhotos(document.getElementById('edPhotos'), photosState, refreshDirty);
    baselineState.photos = photosState.slice();
    refreshDirty();
  });

  saveBtn.addEventListener('click', async () => {
    clearErrors();
    saveNote.hidden = true;
    saveBtn.disabled = true;
    saveBtn.innerHTML = `${loadingRing(16)}Saving…`;
    const body = readState();
    try {
      const res = await fetch(`/api/venues/${encodeURIComponent(venue.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!data) throw new Error('bad response');

      if (!data.ok) {
        if (data.errors) {
          for (const [field, msg] of Object.entries(data.errors)) {
            const el = root.querySelector(`[data-err-for="${field}"]`);
            if (el) el.textContent = msg;
          }
        }
        saveNote.hidden = false;
        saveNote.className = 'ed-save-note ed-save-note-error';
        saveNote.textContent = data.errors ? 'Fix the highlighted fields and try again.' : (data.error || 'Save failed — try again.');
        saveBtn.textContent = 'Save';
        saveBtn.disabled = false; // still dirty — let them retry
        return;
      }

      // re-baseline to the values just saved, so Save disables again until
      // the owner changes something new. photosState is mutated in place
      // (not reassigned) — edRenderPhotos()'s up/down/remove handlers close
      // over this exact array object, and swapping in a new one here would
      // silently orphan them on any further photo edit after this save.
      Object.assign(venue, data.venue);
      photosState.length = 0;
      photosState.push(...(venue.photos || []));
      baselineState = readState();
      saveBtn.textContent = 'Save';
      saveBtn.disabled = true;
      saveNote.hidden = false;
      saveNote.className = 'ed-save-note ed-save-note-ok';
      // gentle, not gating — the save already succeeded either way (see
      // CLAUDE.md task this was added for: Sunin's venue saved with both
      // fields null and nothing told her). Reinforced here on every save,
      // not just the first one after submission, since an owner could also
      // clear both fields back out during a later edit.
      const stillEmpty = !body.short && !body.description;
      const base = data.location_review
        ? "Thanks — we'll check the pin against your map link."
        : 'Saved.';
      saveNote.textContent = stillEmpty
        ? `${base} Your venue will look empty without a short tagline or description.`
        : base;
    } catch (e) {
      saveNote.hidden = false;
      saveNote.className = 'ed-save-note ed-save-note-error';
      saveNote.textContent = 'Connection error — try again.';
      saveBtn.textContent = 'Save';
      saveBtn.disabled = false;
    }
  });
}

/* ---------- admin: pending venue review ---------- */
// only reachable from the flame sheet's "Pending venues (N)" entry, itself
// only rendered when /api/me's is_admin is true (js/app.js
// renderFlameSheetBody()) — but that's UX only, same as everywhere else
// admin shows up in this file: every actual approve/reject call is
// re-checked server-side against the session's own user id (see
// functions/api/venues/[id]/approve.js, reject.js), never trusting this
// client-side gate.
function openAdminPendingSheet(pendingVenues) {
  toggleSheet(false);
  setSheetView({ type: 'admin-pending', venueId: null });

  const cardsHtml = pendingVenues.length
    ? pendingVenues.map(adminPendingCardHtml).join('')
    : '<div class="s-sub" style="text-align:center;padding:30px 0;">Nothing waiting on review.</div>';

  setSheet(`
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <button class="sheet-x" data-back-flame aria-label="Back">←</button>
      <div class="s-title" style="flex:1;text-align:center;">Pending venues</div>
      <span style="width:32px;flex-shrink:0;"></span>
    </div>
    <div id="admList">${cardsHtml}</div>
  `);

  const sheet = document.getElementById('sheet');
  if (sheet) sheet.scrollTop = 0;
  document.querySelector('[data-back-flame]')?.addEventListener('click', openFlameSheet);

  wireAdminPendingSheet();
}

function adminPendingCardHtml(v) {
  const lat = v.suggested_lat != null ? v.suggested_lat : '';
  const lng = v.suggested_lng != null ? v.suggested_lng : '';
  return `
    <div class="adm-card" data-adm-id="${esc(v.id)}">
      <div class="adm-name">${esc(v.short_name || v.name)}</div>
      <div class="adm-meta">${esc(v.area || '—')} · ${esc(v.type)} · submitted by ${esc(v.submitted_by || 'unknown')}</div>
      ${v.description ? `<div class="adm-desc">${esc(v.description)}</div>` : ''}

      ${v.maps_url
        ? `<a class="adm-maps-link" href="${esc(v.maps_url)}" target="_blank" rel="noopener noreferrer">Open Maps link ↗</a>`
        : '<div class="ed-hint">No Maps link submitted.</div>'}
      <div class="ed-hint">${v.suggested_lat != null
        ? 'Suggested from the Maps link — check it, not confirmed yet.'
        : "Couldn't resolve coordinates from the link — enter them by hand."}</div>

      <div class="adm-coords">
        <input type="number" step="any" class="ed-input adm-lat" placeholder="latitude" value="${lat}">
        <input type="number" step="any" class="ed-input adm-lng" placeholder="longitude" value="${lng}">
      </div>
      <div class="ed-err adm-err"></div>

      <div class="btn-row adm-actions">
        <button type="button" class="btn btn-go adm-approve" style="flex:1;">Approve</button>
        <button type="button" class="btn btn-back adm-reject-toggle" style="flex:1;">Reject</button>
      </div>

      <div class="adm-reject-panel" hidden>
        <textarea class="ed-textarea adm-reason" maxlength="300" rows="2" placeholder="Why? The owner will see this."></textarea>
        <div class="btn-row">
          <button type="button" class="btn btn-go adm-reject-confirm" style="flex:1;">Confirm reject</button>
          <button type="button" class="btn btn-back adm-reject-cancel" style="flex:1;">Cancel</button>
        </div>
      </div>
    </div>`;
}

// removes a card once its venue has been approved/rejected, and swaps in
// the empty state if that was the last one — no full re-fetch needed since
// the server call already told us it succeeded
function admRemoveCard(card) {
  card.remove();
  const list = document.getElementById('admList');
  if (list && !list.querySelector('.adm-card')) {
    list.innerHTML = '<div class="s-sub" style="text-align:center;padding:30px 0;">Nothing waiting on review.</div>';
  }
}

function wireAdminPendingSheet() {
  const root = document.getElementById('sheetInner');

  root.querySelectorAll('.adm-card').forEach(card => {
    const id = card.dataset.admId;
    const errEl = card.querySelector('.adm-err');
    const approveBtn = card.querySelector('.adm-approve');
    const rejectToggle = card.querySelector('.adm-reject-toggle');
    const rejectPanel = card.querySelector('.adm-reject-panel');
    const rejectConfirm = card.querySelector('.adm-reject-confirm');
    const rejectCancel = card.querySelector('.adm-reject-cancel');

    approveBtn.addEventListener('click', async () => {
      errEl.textContent = '';
      const lat = Number(card.querySelector('.adm-lat').value);
      const lng = Number(card.querySelector('.adm-lng').value);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        errEl.textContent = 'Enter both coordinates before approving.';
        return;
      }
      approveBtn.disabled = true;
      rejectToggle.disabled = true;
      approveBtn.textContent = 'Approving…';
      try {
        const res = await fetch(`/api/venues/${encodeURIComponent(id)}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat, lng }),
        });
        const data = await res.json().catch(() => null);
        if (!data?.ok) throw new Error(data?.error || 'approve failed');
        admRemoveCard(card);
      } catch (e) {
        errEl.textContent = 'Could not approve — try again.';
        approveBtn.disabled = false;
        rejectToggle.disabled = false;
        approveBtn.textContent = 'Approve';
      }
    });

    rejectToggle.addEventListener('click', () => { rejectPanel.hidden = !rejectPanel.hidden; });
    rejectCancel.addEventListener('click', () => { rejectPanel.hidden = true; });

    rejectConfirm.addEventListener('click', async () => {
      errEl.textContent = '';
      const reason = card.querySelector('.adm-reason').value.trim();
      if (!reason) { errEl.textContent = 'A reason is required.'; return; }
      rejectConfirm.disabled = true;
      rejectConfirm.textContent = 'Rejecting…';
      try {
        const res = await fetch(`/api/venues/${encodeURIComponent(id)}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        });
        const data = await res.json().catch(() => null);
        if (!data?.ok) throw new Error(data?.error || 'reject failed');
        admRemoveCard(card);
      } catch (e) {
        errEl.textContent = 'Could not reject — try again.';
        rejectConfirm.disabled = false;
        rejectConfirm.textContent = 'Confirm reject';
      }
    });
  });
}

// upload a photo straight to Cloudinary using a signature from
// /api/upload-signature, then PATCH just the photos field onto the venue —
// deliberately its own save, not folded into the main Save button, so a
// slow/flaky mobile upload doesn't block on (or get lost with) whatever
// else the owner is mid-editing elsewhere in the form
function wireVenuePhotoUpload(venue, root, photosState, onSaved) {
  const fileInput = root.querySelector('#edPhotoFile');
  const addBtn = root.querySelector('#edPhotoAddBtn');
  const progressWrap = root.querySelector('#edPhotoProgress');
  const progressBar = root.querySelector('#edPhotoProgressBar');
  const progressLabel = root.querySelector('#edPhotoProgressLabel');
  const uploadErr = root.querySelector('[data-err-for="upload"]');
  if (!fileInput || !addBtn) return;

  const refreshAddBtn = () => {
    const full = photosState.length >= MAX_PHOTOS;
    addBtn.disabled = full;
    addBtn.textContent = full ? `Max ${MAX_PHOTOS} photos` : '+ Add photo';
  };
  refreshAddBtn();

  // attaches an already-uploaded Cloudinary asset to the venue, stored as
  // "<version>/<publicId>" (see cloudinaryUrl()); split out so a failed
  // PATCH (upload succeeded, save didn't) can be retried without
  // re-uploading the file
  async function attachPhoto(stored) {
    const res = await fetch(`/api/venues/${encodeURIComponent(venue.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photos: photosState.concat(stored) }),
    });
    const data = await res.json().catch(() => null);
    if (!data || !data.ok) {
      throw new Error((data?.errors?.photos) || data?.error || 'could not save the photo');
    }
    venue.photos = data.venue.photos;
    photosState.length = 0;
    photosState.push(...venue.photos);
    refreshAddBtn();
    onSaved();
  }

  function showRetry(message, stored) {
    uploadErr.innerHTML = `${esc(message)} — <button type="button" class="ed-photo-retry" id="edPhotoRetryBtn">Retry</button>`;
    uploadErr.querySelector('#edPhotoRetryBtn').addEventListener('click', async () => {
      uploadErr.textContent = 'Saving…';
      try {
        await attachPhoto(stored);
        uploadErr.textContent = '';
      } catch (e) {
        showRetry(e.message || 'could not save the photo', stored);
      }
    });
  }

  addBtn.addEventListener('click', () => {
    uploadErr.textContent = '';
    fileInput.value = '';
    fileInput.click();
  });

  // uploads one file straight to Cloudinary (signed, scoped to this venue's
  // folder — see upload-signature.js) and resolves to the
  // "<version>/<publicId>" ref; the batch loop below decides what a
  // rejection means for the rest of a multi-file selection. progressPrefix
  // ("Uploading 2 of 4… " or just "Uploading… " for a single file) stays in
  // front of the percentage ring for the whole upload.
  async function uploadOneFile(file, progressPrefix) {
    const sigRes = await fetch('/api/upload-signature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venue_id: venue.id }),
    });
    const sig = await sigRes.json().catch(() => null);
    if (!sig || !sig.ok) throw new Error(sig?.error || 'could not start upload');

    // sig.params is exactly the key/value set /api/upload-signature signed
    // (see its comment on why this can't be reconstructed client-side —
    // that drift is what caused the "Invalid Signature" bug) — sent
    // verbatim, plus the three params that are deliberately never signed
    const form = new FormData();
    form.append('file', file);
    form.append('api_key', sig.api_key);
    form.append('signature', sig.signature);
    for (const [key, value] of Object.entries(sig.params)) {
      form.append(key, value);
    }

    const uploadResult = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `https://api.cloudinary.com/v1_1/${sig.cloud_name}/image/upload`);
      xhr.upload.addEventListener('progress', (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.round((e.loaded / e.total) * 100);
        progressBar.style.width = pct + '%';
        progressLabel.innerHTML = `${progressPrefix}${uploadPctHtml(pct)}`;
      });
      xhr.onload = () => {
        let data;
        try { data = JSON.parse(xhr.responseText); } catch (e) { reject(new Error('upload failed')); return; }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data?.error?.message || 'upload failed'));
      };
      xhr.onerror = () => reject(new Error('connection error during upload'));
      xhr.send(form);
    });

    return `v${uploadResult.version}/${uploadResult.public_id}`;
  }

  fileInput.addEventListener('change', async () => {
    uploadErr.textContent = '';
    const picked = [...fileInput.files];
    if (!picked.length) return;

    // still capped at MAX_PHOTOS per venue — take the first N the selection
    // fits and say so plainly rather than silently dropping the rest
    const room = MAX_PHOTOS - photosState.length;
    const files = picked.slice(0, room);
    const skipped = picked.length - files.length;

    addBtn.disabled = true;
    progressWrap.hidden = false;

    // sequential, not Promise.all — several large phone photos at once on a
    // Lao mobile connection will stall if they all fight for bandwidth
    let uploadedCount = 0;
    const failed = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const prefix = files.length > 1 ? `Uploading ${i + 1} of ${files.length}… ` : 'Uploading… ';
      progressBar.style.width = '0%';
      progressLabel.innerHTML = `${prefix}${uploadPctHtml(0)}`;

      if (!file.type.startsWith('image/')) { failed.push(`${file.name} (images only)`); continue; }
      if (file.size > MAX_PHOTO_BYTES) { failed.push(`${file.name} (over 8MB)`); continue; }

      let uploadedRef;
      try {
        uploadedRef = await uploadOneFile(file, prefix);
      } catch (e) {
        failed.push(`${file.name} (${e.message || 'upload failed'})`);
        continue;
      }

      progressLabel.textContent = 'Saving…';
      try {
        await attachPhoto(uploadedRef);
        uploadedCount++;
      } catch (e) {
        // the file is already sitting in Cloudinary at this point. For a
        // single file this is exactly the old retry flow — no need to
        // re-upload, just retry the attach. For a batch, folding it into
        // the failure report (rather than popping a retry button per file)
        // keeps the rest of the batch moving.
        if (files.length === 1) {
          progressWrap.hidden = true;
          refreshAddBtn();
          showRetry(e.message || 'could not save the photo', uploadedRef);
          return;
        }
        failed.push(`${file.name} (${e.message || 'could not save'})`);
      }
    }

    progressWrap.hidden = true;
    refreshAddBtn();

    const notes = [];
    if (skipped > 0) notes.push(`Only room for ${room} more — uploaded the first ${room}, skipped ${skipped}.`);
    if (failed.length) notes.push(`${uploadedCount} uploaded, ${failed.length} failed: ${failed.join(', ')}.`);
    uploadErr.textContent = notes.join(' ');
  });
}

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
      console.log('[muan] positron road layers:', roadLayers.map(l => ({ id: l.id, color: l.paint?.['line-color'] })));
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
    if (state.theme === 'light') {
      const symbolLayers = state.map.getStyle().layers.filter(l => l.type === 'symbol');
      console.log('[muan] positron symbol layers:', symbolLayers.map(l => l.id));
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
// deliberately a plain single-path outline, not the detailed miniFlame
// (mf-outer/mf-core layered SVG) used elsewhere — that turns to mush at nav
// icon size
function icoFlameNav(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 21c-4 0-7-3-7-7 0-2.8 1.6-5 3-7.2C8.3 8.2 9 10 10 10.5 9.5 7 11 4 12 2c1 2 2.5 5 2 8.5 1-.5 1.7-2.3 2-3.7C17.4 8.8 19 11 19 13.8c0 4.3-3 7.2-7 7.2Z"/></svg>`;
}

function icoSurprise(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="4.5" y="4.5" width="15" height="15" rx="3.5"/>
    <circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/>
    <circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" stroke="none"/></svg>`;
}

function renderMarkers() {
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
    const hasEventToday = state.events.some(ev => ev.venue_id === v.id && ev.date === today);
    const isPick = (state.picks?.venue_ids || []).includes(v.id)
                   && Array.isArray(v.photos) && v.photos.length > 0;
    el.classList.toggle('pin-event', hasEventToday);
    el.classList.toggle('pin-pick', isPick && !hasEventToday);
    const variant = hasEventToday ? 'event' : (isPick ? 'pick' : null);
    el.innerHTML = `
      ${pinSVG(hot ? '#FF5A3C' : COLORS[v.type] || '#8A8494', hot ? 1.25 : 1, variant)}
      <div class="m-label">${esc(v.short_name || v.name)}</div>
      ${hot ? `<div class="m-sub" style="color:#FF5A3C">tonight</div>` : ''}`;
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
}

/* phase 1 "No.1 tonight" = first venue with a verified event today.
   phase 2 replaces this with real check-in counts from the API. */
function isNo1(v) {
  const today = todayISO();
  const first = state.events.find(ev => ev.date === today);
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
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  if (st.open) return `<span class="status-pill open">${esc(full ? cap(st.label) : 'Open')}</span>`;
  if (st.openingSoon) return `<span class="status-pill soon">${esc(cap(st.label))}</span>`;
  return `<span class="status-pill closed">Closed</span>`;
}

// wraps a card's photo <img> so statusPillHtml() can sit absolutely
// positioned over its top-left corner without the fade applied to .closed
// cards' text ever touching the photo itself (see .status-pill/.photo-wrap
// in style.css)
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
      ${sub2 ? `<div class="hc-sub" style="font-size:10.5px;color:var(--dim);">${esc(sub2)}</div>` : ''}
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
  // closed venues stay visible, just dimmed (item 1: never hide, someone
  // looking at 4pm for tonight still wants to see a bar that opens at 8)
  return `<div class="card card-big${openStatus(v).open ? '' : ' closed'}" data-open-venue="${v.id}">
    ${photoWrap(media, v, true)}
    <div class="card-body">
      <div class="cb-name">${esc(v.short_name || v.name)}</div>
      <div class="t-sub">${sub}</div>
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
function rowCard(v, extraLine) {
  const st = openStatus(v);
  const thumb = (v.photos && v.photos.length)
    ? `<img class="thumb" src="${esc(cloudinaryUrl(v.photos[0], 300))}" alt="" loading="lazy">`
    : `<img class="thumb" src="${venueTileUri(v.short_name || v.name, v.type, false)}" alt="" loading="lazy">`;
  // closed venues stay visible, just dimmed (item 1: never hide, someone
  // looking at 4pm for tonight still wants to see a bar that opens at 8)
  return `<div class="card${st.open ? '' : ' closed'}" data-open-venue="${v.id}">
    ${photoWrap(thumb, v, false)}
    <div class="card-body">
      <span class="t-name">${esc(v.short_name || v.name)}</span>
      ${extraLine ? `<div class="t-sub">${extraLine}</div>` : ''}
      <div class="t-sub">${venueLine(v, esc(v.area || ''))}</div>
    </div>
  </div>`;
}

// "Surprise me": a random OPEN venue of `filter`'s type ('bar' | 'cafe' —
// see surpriseMeHtml(), the only two filters this button ever shows for),
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
  const label = document.querySelector('[data-surprise-me] .surprise-label');
  if (!label) return;
  const original = label.textContent;
  label.textContent = msg;
  setTimeout(() => { if (label.isConnected && label.textContent === msg) label.textContent = original; }, 2500);
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
// mask itself is CSS (border-radius:50%, see .fl-pfp/#avatarSlot img), not
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
  venue: '<rect x="5" y="7" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 7 12 3 19 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'
};

function mixHex(fromHex, toHex, amount) {
  const a = fromHex.replace('#', ''), b = toHex.replace('#', '');
  const chan = i => Math.round(parseInt(a.slice(i, i + 2), 16) + (parseInt(b.slice(i, i + 2), 16) - parseInt(a.slice(i, i + 2), 16)) * amount)
    .toString(16).padStart(2, '0');
  return `#${chan(0)}${chan(2)}${chan(4)}`;
}

function venueTileUri(name, type, wide) {
  const letter = (name || '?').charAt(0).toUpperCase();
  const glyphKey = type === 'cafe' ? 'cafe' : type === 'bar' ? 'bar' : 'venue';
  const fgVar = type === 'cafe' ? '--teal' : type === 'bar' ? '--flame' : '--violet';
  const cs = getComputedStyle(document.documentElement);
  const fg = cs.getPropertyValue(fgVar).trim() || '#8A8494';
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
    `<text x="${lx}" y="${ly}" font-family="Space Grotesk, sans-serif" font-weight="700" font-size="${fontSize}" fill="${fg}">${esc(letter)}</text>` +
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
    <button type="button" class="lightbox-next" aria-label="Next photo">›</button>
    <div class="lightbox-count"></div>`;
  document.body.appendChild(ov);
  lightbox = { photos, index, ov };
  lightboxRender();
  requestAnimationFrame(() => ov.classList.add('show'));

  // tap outside the image (the backdrop itself) closes, same as ×
  ov.addEventListener('click', (e) => { if (e.target === ov) closeLightbox(); });
  ov.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
  ov.querySelector('.lightbox-prev').addEventListener('click', () => lightboxStep(-1));
  ov.querySelector('.lightbox-next').addEventListener('click', () => lightboxStep(1));
  document.addEventListener('keydown', lightboxKeydown);

  let touchStartX = null;
  ov.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
  ov.addEventListener('touchend', (e) => {
    if (touchStartX == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) lightboxStep(dx > 0 ? -1 : 1);
    touchStartX = null;
  }, { passive: true });
}

// wires the fallback for one <img>: onerror swaps in the monogram
// immediately; a 6s watchdog covers requests that never fire load OR error
// (a stalled connection, a host that hangs) since a blank box is worse than
// a letter. onSettled(ok) — used by watchCollageCard() for hero promotion —
// fires once either way, after any monogram swap has already happened.
function watchImgLoad(img, v, onSettled) {
  // re-arms cleanly if called again on an img whose src just changed (see
  // the gallery's thumbnail-click handler, which swaps #galHero's photo)
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
      const wide = img.classList.contains('big-thumb') || img.classList.contains('gal-hero');
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
// card, when observeCollageCards() decides it's actually time to load it
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
// pinned-state affordance for the sticky chip bar (see #sheet .chip-bar in
// style.css) — an IntersectionObserver on a 1px-tall sentinel placed just
// above it, rather than a scroll listener: no per-scroll-frame handler on
// exactly the phones this bar's pinning bug was reported on, and the same
// pattern collageObserver below already uses against this same #sheet
// root. When the sentinel scrolls out of view the bar has stuck; toggling
// .pinned adds the hairline that makes the stuck state read as intentional
// rather than a rendering glitch.
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
  document.querySelectorAll('.collage-card').forEach(card => collageObserver.observe(card));
}

/* ---------- Recommended cafés: photo-collage cards ---------- */
// "closed" already says so on its own (openStatus() covers "closed today" /
// "closed" / "hours unconfirmed" / a venue's own hours_note); only the
// not-yet-open case ("opens 10 am") needs a "closed ·" prefix to read
// honestly at a glance
function collageStatusLine(v) {
  const st = openStatus(v);
  const statusPart = (st.open || /^closed/.test(st.label) || !v.hours)
    ? st.label
    : `closed · ${st.label}`;
  // reachable in principle even though the Recommended tab already filters
  // pending venues out (see renderHomeSheet()) — same null-coordinate guard
  // as venueLine()
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
// data-src; observeCollageCards() swaps it in once the card is about to
// scroll into view (see loadCollageCardPhotos()), rather than all three
// tiles across every card requesting a photo the moment the tab opens.
function collagePhotosHtml(v, altName) {
  const photos = v.photos || [];
  const phBig = venueTileUri(v.short_name || v.name, v.type, true);
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

// whole-card-tappable collage card for the Cafes › Recommended tab — an
// ordinary sheet element (no fixed positioning, no gesture handlers); reuses
// setSheet()'s [data-open-venue] delegation like every other card
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
        ${descLine ? `<div class="collage-desc">${esc(descLine)}</div>` : ''}
        ${facts.length ? `<div class="collage-facts">${facts.map(f => `<span>${esc(f)}</span>`).join('')}</div>` : ''}
      </div>
    </div>`;
}

// funnel for any "go to home" action that isn't an explicit back/close —
// a sticky routed venue (state.routeVenueId) wins over an incidental
// re-render, per clearRoute()'s comment on when a route is allowed to die
function goHome() {
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
function surpriseMeHtml(filter) {
  const label = filter === 'bar' ? 'Surprise me · ບາຣ໌ໃດກໍໄດ້' : 'Surprise me · ຄາເຟໃດກໍໄດ້';
  return `<button class="surprise-btn" data-surprise-me>
    ${icoSurprise(20)}<span class="surprise-label">${label}</span>
  </button>`;
}

function renderHomeSheet() {
  state.selectedId = null; if (state.map) updateSelection();
  setSheetView({ type: 'home', venueId: null });
  setMobileScreen('home');
  // does NOT clear the route — a route should only clear when the venue
  // sheet is explicitly closed (see the data-home handler below), a
  // different venue opens, or Directions is toggled off, never just because
  // the map was clicked or the sheet re-rendered for some other reason
  const byTime = (a,b) => (a.date === b.date)
    ? ((a.start_time || '99:99') < (b.start_time || '99:99') ? -1 : 1)
    : (a.date < b.date ? -1 : 1);
  const today = todayISO();
  const tonight = state.events.filter(ev => ev.date === today).sort(byTime);
  const upcoming = state.events.filter(ev => ev.date > today).sort(byTime);

  const f = state.filter || 'all';
  const matchType = v => f === 'all'
    || (f === 'bar' && v.type === 'bar')
    || (f === 'cafe' && v.type === 'cafe');
    // 'event' filter shows no venue-driven sections; handled via showEvents/showVenueSections

  const late = state.venues.filter(v => opensLate(v) && matchType(v) && v.status !== 'opening-soon');
  // On fire / Busy spots are editorial (Kar's picks, state.picks.*) — a
  // pending venue (no confirmed location yet) is excluded even if it
  // somehow ended up in picks.json, same as Recommended below
  const notPending = v => v.pin_status !== 'pending';
  const pickVenues = (state.picks?.venue_ids || []).map(venueById).filter(Boolean).filter(matchType).filter(notPending);
  const busyVenues = (state.picks?.busy_venue_ids || []).map(venueById).filter(Boolean).filter(matchType).filter(notPending);
  const openingSoon = state.venues.filter(v => v.status === 'opening-soon' && matchType(v));

  const showEvents = (f === 'all' || f === 'event');
  const showVenueSections = (f !== 'event');

  const secH = (color, label, note, icon) =>
    `<div class="sec-h">${icon || `<span class="dot" style="background:var(--${color});"></span>`}${label}${note ? `<span class="sec-note">${note}</span>` : ''}</div>`;

  const sub = isNight() ? 'ຄືນນີ້ໄປໃສດີ?' : 'ມື້ນີ້ໄປໃສດີ?';

  if (f === 'bar' || f === 'cafe') {
    const color = f === 'bar' ? 'flame' : 'teal';
    const label = f === 'bar' ? 'Bars · ບາຣ໌' : 'Cafes · ຄາເຟ';
    let html = `
      <div class="s-title">${dayGreeting()}, Vientiane</div>
      <div class="s-sub lao">${sub}</div>
      ${surpriseMeHtml(f)}
      <div id="chipSentinel"></div>
      <div id="chipSlot"></div>`;
    html += secH(color, label);

    const cafeTab = state.cafeTab || 'recommended';
    if (f === 'cafe') {
      html += `
        <div class="seg" role="tablist">
          <button class="seg-btn ${cafeTab === 'recommended' ? 'on' : ''}" data-cafe-tab="recommended" role="tab" aria-selected="${cafeTab === 'recommended'}">Recommended</button>
          <button class="seg-btn ${cafeTab === 'all' ? 'on' : ''}" data-cafe-tab="all" role="tab" aria-selected="${cafeTab === 'all'}">All cafés</button>
        </div>`;
    }

    if (f === 'cafe' && cafeTab === 'recommended') {
      // cafés with enough photos for a collage card to be worth showing —
      // pending venues excluded, same as On fire/Busy spots above
      const cafeGallery = sortForDisplay(state.venues
        .filter(v => v.type === 'cafe' && v.pin_status !== 'pending' && (v.photos?.length || 0) >= 2)
        .sort((a, b) => (b.photos.length - a.photos.length) ||
          (a.short_name || a.name).localeCompare(b.short_name || b.name)));
      if (!cafeGallery.length) {
        html += `<div class="sec-empty"><div class="sec-empty-ico" data-empty-svg></div>Nothing here right now — try another filter.</div>`;
      } else {
        html += cafeGallery.map(v => collageCardHtml(v)).join('');
      }
    } else {
      const typeVenues = sortForDisplay(state.venues.filter(v => v.type === f)
        .sort((a, b) => (a.short_name || a.name).localeCompare(b.short_name || b.name)));
      if (!typeVenues.length) {
        html += `<div class="sec-empty"><div class="sec-empty-ico" data-empty-svg></div>Nothing here right now — try another filter.</div>`;
      } else if (isMobile()) {
        html += typeVenues.map(v => rowCard(v)).join('');
      } else {
        for (const v of typeVenues) {
          const st = openStatus(v);
          const thumb = (v.photos && v.photos.length) ? `<img class="thumb" src="${esc(cloudinaryUrl(v.photos[0], 200))}" alt="" loading="lazy">` : `<img class="thumb" src="${venueTileUri(v.short_name || v.name, v.type, false)}" alt="" loading="lazy">`;
          html += `
            <div class="card${st.open ? '' : ' closed'}" data-open-venue="${v.id}">
              ${photoWrap(thumb, v, false)}
              <div class="card-body">
                <span style="font-size:13.5px;font-weight:700;">${esc(v.short_name || v.name)}</span>
                <div class="t-sub">${venueLine(v, esc(v.area || ''))}</div>
              </div>
            </div>`;
        }
      }
    }
    setSheet(html);
    injectEmptyIcons();
    observeCollageCards();
    history.replaceState(null, '', location.pathname);
    const sh = document.getElementById('sheet');
    sh.classList.remove('sheet-anim'); void sh.offsetWidth; sh.classList.add('sheet-anim');
    return;
  }

  let html = `
    <div class="s-title">${dayGreeting()}, Vientiane</div>
    <div class="s-sub lao">${sub}</div>
    <div id="chipSentinel"></div>
    <div id="chipSlot"></div>`;
  let rendered = false;
  const mobile = isMobile();
  // horizontal-scroll carousel (desktop, unchanged) vs. a vertical list of
  // row cards (mobile Pass 2) — every non-hero section below picks between
  // these the same way
  const sectionWrap = cardsHtml => mobile ? cardsHtml : `<div class="hcards">${cardsHtml}</div>`;

  if (showEvents && tonight.length) {
    rendered = true;
    html += secH('violet', 'Tonight · ຄືນນີ້');
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

  if (showEvents && !tonight.length && !upcoming.length) {
    rendered = true;
    html += secH('violet', 'Tonight · ຄືນນີ້') +
      `<div class="sec-empty"><div class="sec-empty-ico" data-empty-svg></div>Nothing verified yet — new list every Thursday.</div>`;
  }

  const pickVenuesQ = sortEditorial(pickVenues);
  if (showVenueSections && pickVenuesQ.length) {
    rendered = true;
    html += secH('flame', 'On fire · ໄຟລຸກ', esc(state.picks?.note_en), miniFlame()) +
      pickVenuesQ.map(v => bigCard(v, venueLine(v, esc(v.area || '')))).join('') +
      `<div style="font-size:10.5px;color:var(--dim);margin-top:8px;">live check-in rankings coming soon</div>`;
  }

  const busyVenuesQ = sortEditorial(busyVenues);
  if (showVenueSections && busyVenuesQ.length) {
    rendered = true;
    html += secH('flame', 'Busy spots · ບ່ອນຄົນຫຼາຍ', esc(state.picks?.busy_note_en)) +
      sectionWrap(busyVenuesQ.map(v => mobile ? rowCard(v) : sectionCard(v, venueLine(v, esc(v.area || '')))).join('')) +
      `<div style="font-size:10.5px;color:var(--dim);margin-top:8px;">our picks for now — live counts when check-ins launch</div>`;
  }

  if (showEvents && upcoming.length) {
    rendered = true;
    html += secH('violet', 'Coming up · ອີເວັນຕໍ່ໄປ') + sectionWrap(upcoming.map(ev => {
      const v = venueById(ev.venue_id);
      const evSub = `${fmtDate(ev.date)} · ${esc(ev.title)}`;
      if (!v) {
        return mobile
          ? `<div class="card"><img class="thumb" src="${venueTileUri(ev.title, 'venue', false)}" alt="" loading="lazy">
              <div class="card-body"><span class="t-name">${esc(ev.title)}</span>
              <div class="t-sub">${fmtDate(ev.date)}${ev.short ? ' · ' + esc(ev.short) : ''}</div></div></div>`
          : `<div class="hcard">
            ${ev.photo ? `<img class="thumb" src="${esc(cloudinaryUrl(ev.photo, 200))}" alt="" loading="lazy">` : `<img class="thumb" src="${venueTileUri(ev.title, 'venue', false)}" alt="" loading="lazy">`}
            <div>
              <div style="font-size:12.5px;font-weight:700;">${esc(ev.title)}</div>
              <div class="hc-sub" style="font-size:11px;color:var(--mute);">${fmtDate(ev.date)}${ev.short ? ' · ' + esc(ev.short) : ''}</div>
            </div>
          </div>`;
      }
      return mobile ? rowCard(v, evSub) : sectionCard(v, evSub, ev.photo, venueLine(v, ''));
    }).join(''));
  }

  const openingSoonQ = sortForDisplay(openingSoon);
  if (showVenueSections && openingSoonQ.length) {
    rendered = true;
    html += secH('violet', 'Opening soon · ກຳລັງຈະເປີດ') +
      sectionWrap(openingSoonQ.map(v => mobile ? rowCard(v) : sectionCard(v, venueLine(v, esc(v.area || '')))).join(''));
  }

  const lateQ = sortForDisplay(late);
  if (showVenueSections && lateQ.length) {
    rendered = true;
    html += secH('teal', 'Open late · ເປີດເດິກ') +
      sectionWrap(lateQ.map(v => mobile ? rowCard(v) : sectionCard(v, venueLine(v, openStatus(v).label))).join(''));
  }


  if (!rendered) {
    html += `<div class="sec-empty"><div class="sec-empty-ico" data-empty-svg></div>Nothing here right now — try another filter.</div>`;
  }

  setSheet(html);
  injectEmptyIcons();
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
    lbl.textContent = state.geoError === 'blocked' ? 'Location blocked'
      : (state.geoError === 'timeout' || state.geoError === 'unavailable') ? "Can't find you"
      : 'Enable location to check in';
  } else {
    const d = haversine(state.userPos, v);
    if (d <= 150) {
      cbtn.disabled = false;
      cbtn.classList.add('ready');
      lbl.textContent = "You're here — check in";
    } else {
      lbl.textContent = `${fmtDist(d)} away — get closer`;
    }
  }
}

/* ---------- sheet: venue detail ---------- */
function openVenue(id) {
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
  let galleryHtml;
  if (!photos.length) {
    galleryHtml = `<div class="gal"><img class="gal-hero" src="${venueTileUri(v.short_name || v.name, v.type, true)}" alt="${esc(v.name)}"></div>`;
  } else {
    galleryHtml = `
      <div class="gal">
        <img class="gal-hero" id="galHero" src="${esc(cloudinaryUrl(photos[0], 900))}" alt="${esc(v.name)}" loading="lazy">
        ${photos.length > 1 ? `<div class="gal-thumbs">` +
          photos.map((p, i) =>
            `<img class="gal-thumb ${i===0?'sel':''}" src="${esc(cloudinaryUrl(p, 200))}" data-gi="${i}" alt="" loading="lazy">`
          ).join('') + `</div>` : ''}
      </div>`;
  }

  let travel;
  if (isPending) {
    travel = 'Location being confirmed';
  } else if (hasStickyRoute) {
    travel = state.routeLabel;
  } else if (state.userPos) {
    travel = `${fmtDist(haversine(state.userPos, v))} away · straight line`;
  } else {
    travel = `<span class="sub">tap "near me" up top to see distance</span>`;
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

  let html = `
    <span data-venue-detail hidden></span>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <button class="sheet-x" data-home aria-label="Back">←</button>
      <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
        ${isNo1(v) ? '<span class="tag flame" style="background:var(--ink3);padding:5px 10px;border-radius:12px;">TONIGHT</span>' : ''}
        <button class="sheet-x" data-home aria-label="Close">✕</button>
      </div>
    </div>
    <div class="s-title">${esc(v.name)} <span class="lao" style="font-size:13px;color:var(--mute);">${esc(v.name_lo || '')}</span></div>
    <div class="s-sub">${esc(v.short || '')}</div>

    ${galleryHtml}

    <div class="act-row">
      ${isPending ? '' : `
      <button class="act" id="checkinBtn" data-venue="${v.id}" disabled>
        <span class="act-ico">🔥</span><span class="act-lbl" id="checkinLabel">Check in</span>
      </button>
      <button class="act" id="dirBtn">
        <span class="act-ico">➤</span><span class="act-lbl" id="dirLbl">Directions</span>
      </button>`}
      <a class="act act-narrow" id="gmapsBtn"
         href="${esc(v.links?.maps || '#')}" target="_blank" rel="noopener"
         aria-label="Open in Google Maps">
        <span class="act-ico">🗺️</span><span class="act-lbl">Maps</span>
      </a>
      <button class="act" id="shareBtn">
        <span class="act-ico">↗</span><span class="act-lbl">Share</span>
      </button>
    </div>

    <div class="v-fact">
      <div class="info-ic">📍</div>
      <div class="info-main">${esc(v.area || '')}<div class="sub" id="travelLine">${travel}</div></div>
    </div>
    <div class="v-fact">
      <div class="info-ic">🕐</div>
      <div class="info-main">
        <span style="color:var(--${st.open ? 'teal' : st.openingSoon ? 'flame' : 'dim'});font-weight:700;">${st.label}</span>
        · <span class="hours-toggle" id="hoursToggle">all hours</span>
        <div class="hours-week" id="hoursWeek">${week}</div>
      </div>
    </div>
    ${v.parking?.note ? `
    <div class="v-fact">
      <div class="info-ic">🅿</div>
      <div class="info-main">${esc(v.parking.note)}</div>
    </div>` : ''}
    ${v.contact?.phone ? `
    <div class="v-fact">
      <div class="info-ic">📞</div>
      <div class="info-main">
        <a href="tel:${esc(v.contact.phone)}" class="v-phone">${esc(v.contact.phone_display)}</a>
        <div class="t-sub">call to book a table</div>
      </div>
    </div>` : ''}
    ${v.description ? `
    <div class="v-fact">
      <div class="info-ic">ℹ️</div>
      <div class="info-main">${esc(v.description)}</div>
    </div>` : ''}
    ${v.signature?.length ? `
    <div class="section-h">Try this · <span class="lao">ລອງອັນນີ້</span></div>
    <div class="v-sig-list">
      ${v.signature.map(it => `
        <div class="v-sig-item">
          <div class="v-sig-name">${esc(it.name)}</div>
          ${(it.price != null || it.note) ? `<div class="v-sig-meta">${it.price != null ? fmtKip(it.price) : ''}${it.price != null && it.note ? ' · ' : ''}${it.note ? esc(it.note) : ''}</div>` : ''}
        </div>`).join('')}
    </div>` : ''}
    ${v.links?.facebook ? `
    <div class="v-fact">
      <div class="info-ic">📘</div>
      <div class="info-main"><a href="${esc(v.links.facebook)}" target="_blank" rel="noopener" style="color:var(--bone);">Facebook page</a></div>
    </div>` : ''}
    ${v.links?.website ? `
    <div class="v-fact">
      <div class="info-ic">🌐</div>
      <div class="info-main"><a href="${esc(v.links.website)}" target="_blank" rel="noopener" style="color:var(--bone);">Website</a></div>
    </div>` : ''}`;

  for (const ev of evs) {
    html += `
      <div class="card" style="cursor:default;">
        <span class="tag violet">${ev.date === todayISO() ? 'TONIGHT' : fmtDate(ev.date)}</span>
        <div style="font-size:13px;font-weight:700;margin-top:3px;">${esc(ev.title)}</div>
        <div class="t-sub">${ev.start_time ? fmtTime(toMins(ev.start_time)) + ' · ' : ''}${fmtPrice(ev.price)}${ev.verified ? '' : ' · unconfirmed'}</div>
      </div>`;
  }

  html += `
    <div class="section-h">Comments</div>
    <div class="comment-empty">
      No comments yet.<br>
      Comments open when check-ins launch — be the first regular. 🔥
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
  document.querySelectorAll('.gal-hero, .gal-thumb').forEach(img => watchImgLoad(img, v));
  // tapping any photo — hero or thumbnail — opens the full-size lightbox at
  // that photo, rather than swapping the hero image in place
  if (photos.length) {
    document.getElementById('galHero')?.addEventListener('click', () => openLightbox(photos, 0));
    document.querySelectorAll('.gal-thumb').forEach(t =>
      t.addEventListener('click', () => openLightbox(photos, +t.dataset.gi)));
  }
  document.getElementById('shareBtn')?.addEventListener('click', async () => {
    const url = location.origin + '/?v=' + v.id;
    const title = (v.short_name || v.name) + ' — Paisaidee';
    if (navigator.share) {
      try { await navigator.share({ title, url }); } catch(e) {}
    } else {
      await navigator.clipboard.writeText(url);
      const ico = document.querySelector('#shareBtn .act-ico');
      if (ico) { ico.textContent = '✓'; setTimeout(() => ico.textContent = '↗', 1500); }
    }
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
  } else if (v.lat != null && v.lng != null) {
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
   setStyle() (used on theme change) swaps in a structurally unrelated style
   (raster vs. Positron vector) and wipes any runtime-added sources/layers,
   so this can't just be a setPaintProperty call — the layers have to be
   able to not exist and get recreated. */
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

function bindStaleWarning() {
  document.getElementById('staleWarningClose')?.addEventListener('click', () => {
    document.getElementById('staleWarning').hidden = true;
  });
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
      document.getElementById('checkinLabel').textContent = 'Too far to check in';
    } else if (data.closed) {
      document.getElementById('checkinLabel').textContent = data.message || 'that place is closed right now';
    } else if (data.same_spot) {
      document.getElementById('checkinLabel').textContent = data.message || "you haven't moved since your last check-in";
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
        ${data.heat_level && data.heat_level !== data.prev_heat_level ? `<div class="cel-row"><span>Your flame</span><b>${data.heat_level}</b></div>` : ''}
        ${data.first_visit ? '<div class="cel-row cel-new"><span>First visit here</span><b>+bonus</b></div>' : `<div class="cel-row"><span>Visits here</span><b>${data.venue_checkins}</b></div>`}
        ${data.new_badges?.length ? data.new_badges.map(b =>
          `<div class="cel-row cel-badge"><span>${b.icon} ${esc(b.name)}</span><b>unlocked</b></div>`
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
  ov.querySelector('.cel-done').addEventListener('click', () => {
    ov.classList.remove('show');
    setTimeout(() => ov.remove(), 300);
    goHome();
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
    return !!e.target.closest('.s-title, .s-sub');
  };

  // horizontal filter-swipe only applies to the home list: not while a venue
  // detail or the avatar sheet is open (#sheet.expanded), not starting on
  // .hcards (they scroll themselves), and not on #sheetHandle (vertical target)
  const canSwipeX = e => !sheet.classList.contains('expanded')
    && !e.target.closest('.hcards') && !e.target.closest('#sheetHandle');

  // touchstart/move/end are delegated on #sheet itself (a static element —
  // only its #sheetInner child's content is replaced on each render)
  const sheet = getSheet();

  sheet.addEventListener('touchstart', e => {
    if (window.innerWidth >= 768) return;
    // TEMP DIAGNOSTIC — remove once confirmed the sheet no longer sticks
    console.log('[sheet-drag] touchstart', { axis, dragging, sheetDragging: sheet.classList.contains('dragging') });
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
      if (Math.abs(moveX) < 12 && Math.abs(moveY) < 12) return;
      axis = Math.abs(moveX) > Math.abs(moveY) ? 'x' : 'y';
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
        const i = FILTER_ORDER.indexOf(state.filter || 'all');
        const atEnd = (dx < 0 && i === FILTER_ORDER.length - 1) || (dx > 0 && i === 0);
        const move = atEnd ? dx * 0.25 : dx;          // resistance at the ends
        inner.classList.add('swiping');
        inner.style.transform = `translateX(${move}px)`;
        inner.style.opacity = String(1 - Math.min(0.45, Math.abs(move) / W));
      }
    }
    // axis === 'none': let the touch fall through to native scrolling (.hcards)
  }, { passive: false });

  const onEnd = () => {
    if (axis === 'y' && dragging) {
      sheet.style.transform = '';        // hand control back to the class
      sheet.scrollTop = startScrollTop;  // in case any scroll slipped through
      toggleSheet(offset > maxOffset() / 2);
      endGesture();
    } else if (axis === 'x') {
      const i = FILTER_ORDER.indexOf(state.filter || 'all');
      const atEnd = (dx < 0 && i === FILTER_ORDER.length - 1) || (dx > 0 && i === 0);
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
    // TEMP DIAGNOSTIC — remove once confirmed the sheet no longer sticks
    console.log('[sheet-drag] touchend', { axis, dragging, sheetDragging: sheet.classList.contains('dragging') });
  };
  sheet.addEventListener('touchend', onEnd);
  sheet.addEventListener('touchcancel', endGesture);
}

// order swiped through on mobile; does not wrap at the ends
const FILTER_ORDER = ['all', 'bar', 'cafe', 'event'];
const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// instant switch, no animation — used for direct chip taps and for a
// committed swipe under prefers-reduced-motion
function changeFilter(dir) {
  const next = FILTER_ORDER.indexOf(state.filter || 'all') + dir;
  if (next < 0 || next >= FILTER_ORDER.length) return;
  const chip = document.querySelector(`.chip[data-filter="${FILTER_ORDER[next]}"]`);
  if (!chip) return;
  chip.click();
  chip.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
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

  const i = FILTER_ORDER.indexOf(state.filter || 'all');
  inner.style.transform = `translateX(${-dir * W * 0.35}px)`;
  inner.style.opacity = '0';
  setTimeout(() => {
    state.filter = FILTER_ORDER[i + dir];
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
    const activeChip = document.querySelector('.chip.on');
    if (activeChip) activeChip.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, 200);
}

function toggleSheet(force) {
  const sh = document.getElementById('sheet');
  const collapsed = force !== undefined ? force : !sh.classList.contains('collapsed');
  sh.classList.toggle('collapsed', collapsed);
  localStorage.setItem('psd-sheet-collapsed', collapsed ? '1' : '0');
}

function setSheet(html) {
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
  inner.querySelectorAll('[data-surprise-me]').forEach(el =>
    el.addEventListener('click', () => quickSurpriseMe(state.filter)));
  inner.querySelectorAll('[data-home]').forEach(el =>
    el.addEventListener('click', () => {
      // on mobile, the venue detail's back arrow / close button returns to
      // whichever screen it was opened over (Home, Map or You) rather than
      // always Home — see leaveVenue(). Every other data-home button (the
      // sign-in prompt's and flame sheet's "Done") always meant "go home",
      // same as before.
      if (isMobile() && state.sheetView.type === 'venue') {
        leaveVenue(state.screenBeforeVenue || 'home');
        return;
      }
      stopTracking();
      if (state.map) clearRoute();     // explicit "leave this sheet" action — the route dies with it
      renderHomeSheet();
    }));
}

function syncChipState() {
  document.querySelectorAll('.chip').forEach(c =>
    c.classList.toggle('on', c.dataset.filter === (state.filter || 'all')));
}

function bindChips() {
  document.querySelectorAll('.chip').forEach(ch => {
    ch.addEventListener('click', () => {
      state.filter = ch.dataset.filter;
      syncChipState();
      // a filter change is an explicit "browse elsewhere" action — return to
      // the home list regardless of what the sheet currently shows, and treat
      // a sticky routed venue (state.routeVenueId) the same as pressing back
      state.selectedId = null;
      if (state.map) clearRoute();
      renderHomeSheet();
      updateSelection();
      renderMarkers();
      const sheet = document.getElementById('sheet');
      if (sheet.classList.contains('collapsed')) toggleSheet(false);
      // keep the tapped chip in view within the scrollable chip row itself —
      // same { inline, block: 'nearest' } shape used after a swipe-driven
      // filter change (see changeFilterAnimated()) so a chip near either
      // edge doesn't get left half-hidden
      ch.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
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
};

// reads state.userPos/state.geoError directly rather than taking an explicit
// state argument, so requestLocation() can call it after updating state
// without both places needing to agree on a status string
function updateLocatePill() {
  const btn = document.getElementById('locateBtn');
  const lbl = document.getElementById('locateLabel');
  if (!btn || !lbl) return;
  if (!('geolocation' in navigator)) { btn.hidden = true; return; }
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
      state.map.flyTo({ center: [pos.lng, pos.lat], zoom: 15 });
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
const venueEvents = id => state.events.filter(ev => ev.venue_id === id);

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const isPast = dateStr => dateStr < todayISO();

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

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

boot();
