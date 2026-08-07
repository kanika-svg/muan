/* ============================================================
   Muan — phase 1
   Map + curated venues/events. No accounts, no check-ins yet.
   Check-ins, streaks and badges arrive in phase 2 (Workers + D1).
   ============================================================ */

const COLORS = { bar: 'var(--pin-bar)', cafe: 'var(--pin-cafe)', event: 'var(--pin-venue)', venue: 'var(--pin-venue)' };
const VIENTIANE = { lng: 102.6030, lat: 17.9630 };
/* normal map fence — initMap() sets these, clearRoute() restores them after a
   route temporarily lifts the fence */
const MAP_BOUNDS = { maxBounds: [[102.45, 17.85], [102.82, 18.15]], minZoom: 12.4 };
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
};

/* ---------- geolocation ---------- */
// TEMP diagnostic — remove once the retry flow is confirmed working.
// ?debug=1 writes into a box in the sheet (phones have no devtools);
// otherwise it just goes to console.log.
const DEBUG_GEO = new URLSearchParams(location.search).get('debug') === '1';
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
// chipBar is one persistent DOM node moved between #topbar (desktop) and
// #sheet (mobile) rather than duplicated, so there's a single source of
// truth for which chip is active. It sits as a sibling of #sheetInner, which
// setSheet() never touches, so it survives every content re-render untouched.
function placeChips() {
  const chipBar = document.getElementById('chipBar');
  const topbar = document.getElementById('topbar');
  const sheet = document.getElementById('sheet');
  if (window.innerWidth < 768) {
    if (!sheet.contains(chipBar)) sheet.insertBefore(chipBar, document.getElementById('sheetInner'));
  } else if (!topbar.contains(chipBar)) {
    topbar.appendChild(chipBar);
  }
}

async function boot() {
  try {
    placeChips();
    window.addEventListener('resize', placeChips);
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
    bindTheme();
    refreshAvatarBtn();
    document.getElementById('avatarBtn').addEventListener('click', openFlameSheet);
    initMap();
    renderHomeSheet();
    bindChips();
    bindLocate();
    bindRouteBar();
    bindMapWarning();
    bindStaleWarning();
    if (vData.stale) showStaleWarning();
    initSheetDrag();

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

    const params = new URLSearchParams(location.search);
    const vid = params.get('v');
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
function refreshAvatarBtn() {
  const i = localStorage.getItem('muan-avatar');
  document.getElementById('avatarSlot').innerHTML = i !== null ? avatarSVG(+i, 20) : '😊';
}
function openAvatarSheet() {
  toggleSheet(false);
  state.sheetView = { type: 'avatar', venueId: null };
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
  state.sheetView = { type: 'flame', venueId: null };
  setSheet('<div class="s-sub" style="text-align:center;padding:30px 0;">Loading your flame…</div>');
  let me = null;
  try { me = await (await fetch('/api/me')).json(); } catch(e) {}
  if (!me || !me.ok) { setSheet('<div class="s-sub" style="text-align:center;padding:30px 0;">Could not load — try again.</div>'); return; }

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
  // passes (one without the "Manage your venue" section, one with it)
  const [flameHtml, myVenues] = await Promise.all([flameSvg(), fetchMyVenues()]);

  if (me.show_intro) { renderFlameIntro(flameHtml, () => renderFlameSheetBody(me, flameHtml, myVenues)); return; }

  renderFlameSheetBody(me, flameHtml, myVenues);
}

// venues the signed-in user owns (see migrations/006_owners.sql), for the
// "Manage your venue" entry point on the flame sheet — fails soft to an
// empty list on any error, since this is secondary content that shouldn't
// block the flame sheet itself from rendering
async function fetchMyVenues() {
  try {
    const data = await (await fetch('/api/my-venues')).json();
    return data.ok ? data.venues : [];
  } catch (e) {
    return [];
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
function renderFlameSheetBody(me, flameHtml, myVenues = []) {
  const stageLabels = { ember:'Ember', flicker:'Flicker', flame:'Flame', blaze:'Blaze', naga:'Naga fire' };
  const stageLo = { ember:'ຖ່ານໄຟ', flicker:'ໄຟວິບວັບ', flame:'ແປວໄຟ', blaze:'ໄຟລຸກ', naga:'ໄຟນາກ' };
  const heatLines = {
    cold: 'your flame has cooled — a night out relights it',
    glowing: 'still glowing',
    warm: 'burning steady',
    burning: 'burning bright',
    roaring: 'roaring 🔥'
  };

  // month calendar
  const now = new Date();
  const yearMonth = me.month;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
  const firstDow = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
  const checkinSet = new Set(me.checkin_days);
  let cal = '<div class="fl-cal">';
  for (let i=0; i<firstDow; i++) cal += '<span class="fl-day empty"></span>';
  for (let d=1; d<=daysInMonth; d++) {
    const iso = `${yearMonth}-${String(d).padStart(2,'0')}`;
    const lit = checkinSet.has(iso);
    const today = d === now.getDate();
    cal += `<span class="fl-day ${lit?'lit':''} ${today?'today':''}">${lit?'🔥':d}</span>`;
  }
  cal += '</div>';

  const monthName = now.toLocaleString('en',{month:'long'});
  const i = localStorage.getItem('muan-avatar');

  const venueCounts = me.venue_counts || {};
  const earnedIds = earnedItems(venueCounts).map(it => it.id);
  const noCheckins = me.total_checkins === 0;

  setSheet(`
    <div class="fl-wrap">
      ${me.handle ? `<div class="fl-handle">@${esc(me.handle)}</div>` : ''}

      <div class="fl-avatar-big">${i !== null ? avatarSVG(+i, 96, earnedIds) : '😊'}</div>

      <div class="fl-month">${monthName}</div>
      ${cal}

      <div class="fl-flame" data-heat="${me.heat_level}">
        ${flameHtml}
        <div class="fl-streak">${noCheckins ? '' : me.streak_months}</div>
      </div>
      <div class="fl-stage">${stageLabels[me.phai_stage]} · <span class="lao">${stageLo[me.phai_stage]}</span></div>
      <div class="fl-sub">${noCheckins ? 'light your first flame — check in anywhere' : esc(heatLines[me.heat_level] || '')}</div>

      ${me.embers_total > 0 ? `<div class="fl-embers"><b>${me.embers_total}</b> embers</div>` : ''}

      ${me.total_checkins > 0 ? `
      <div class="fl-stats">
        <div class="fl-stat"><b>${me.venues_explored}</b><span>places explored</span></div>
        <div class="fl-stat"><b>${me.total_checkins}</b><span>check-ins</span></div>
      </div>` : ''}

      ${myVenues.length ? `
      <div class="fl-manage">
        <div class="fl-manage-h">Manage your venue</div>
        ${myVenues.map(v => `<button class="fl-manage-item" data-manage-venue="${v.id}">
            <span>${esc(v.short_name || v.name)}${v.pin_status === 'pending' ? '<span class="fl-manage-pending"> · pending</span>' : ''}</span><span class="fl-manage-arrow">›</span>
          </button>`).join('')}
      </div>` : ''}

      <button class="fl-avatar-link" data-list-venue>+ List your venue</button>

      ${me.badges?.length ? `
      <div class="fl-badges">
        ${me.badges.map(b => `<div class="fl-badge" title="${esc(b.description||'')}">
           <span class="fl-badge-ico">${b.icon}</span>
           <span class="fl-badge-name">${esc(b.name)}</span>
         </div>`).join('')}
      </div>` : ''}

      <button class="fl-avatar-link" data-open-avatar>Change avatar</button>
      <div class="btn-row"><button class="btn btn-back" data-home style="flex:1;">Done</button></div>
      <button class="fl-signout" data-sign-out>Sign out</button>
    </div>
  `);
  const sheet = document.getElementById('sheet');
  if (sheet) sheet.scrollTop = 0;
  pauseFlameIfReducedMotion();
  document.querySelector('[data-open-avatar]')?.addEventListener('click', openAvatarSheet);
  document.querySelector('[data-sign-out]')?.addEventListener('click', signOut);
  document.querySelector('[data-list-venue]')?.addEventListener('click', openVenueSubmitForm);
  document.querySelectorAll('[data-manage-venue]').forEach(el => el.addEventListener('click', () => {
    const v = myVenues.find(mv => mv.id === el.dataset.manageVenue);
    if (v) openVenueEditor(v);
  }));
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
  return `
    <div class="ed-photo" data-photo-url="${esc(url)}">
      <img src="${esc(cloudinaryResize(url, 200))}" alt="">
      <div class="ed-photo-actions">
        <button type="button" class="ed-photo-up" ${idx === 0 ? 'disabled' : ''} aria-label="Move earlier">↑</button>
        <button type="button" class="ed-photo-down" ${idx === total - 1 ? 'disabled' : ''} aria-label="Move later">↓</button>
        <button type="button" class="ed-photo-remove" aria-label="Remove">✕</button>
      </div>
    </div>`;
}

function edRenderPhotos(container, photos, onChange) {
  container.innerHTML = photos.length
    ? photos.map((p, i) => edPhotoRowHtml(p, i, photos.length)).join('')
    : '<div class="ed-photos-empty">No photos yet</div>';
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
    row.querySelector('.ed-photo-remove')?.addEventListener('click', () => {
      photos.splice(i, 1);
      edRenderPhotos(container, photos, onChange);
      onChange();
    });
  });
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
  state.sheetView = { type: 'venue-submit', venueId: null };

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
      <label class="ed-label" for="subName">Name</label>
      <input type="text" class="ed-input" id="subName" maxlength="100">
      <div class="ed-err" data-err-for="name"></div>
    </div>
    <div class="ed-field">
      <label class="ed-label" for="subShortName">Short name</label>
      <input type="text" class="ed-input" id="subShortName" maxlength="40">
      <div class="ed-err" data-err-for="short_name"></div>
    </div>
    <div class="ed-field">
      <label class="ed-label" for="subNameLo">Lao name</label>
      <input type="text" class="ed-input lao" id="subNameLo" maxlength="60">
      <div class="ed-err" data-err-for="name_lo"></div>
    </div>

    <div class="ed-field">
      <label class="ed-label">Type</label>
      <div class="seg ed-type-seg" id="subTypeSeg">
        <button type="button" class="seg-btn ed-type-btn on" data-type="bar">Bar</button>
        <button type="button" class="seg-btn ed-type-btn" data-type="cafe">Café</button>
        <button type="button" class="seg-btn ed-type-btn" data-type="venue">Venue</button>
      </div>
      <div class="ed-err" data-err-for="type"></div>
    </div>

    <div class="ed-field">
      <label class="ed-label" for="subArea">Area</label>
      <input type="text" class="ed-input" id="subArea" maxlength="80">
      <div class="ed-err" data-err-for="area"></div>
    </div>

    <div class="ed-field">
      <label class="ed-label" for="subShort">Short tagline</label>
      <input type="text" class="ed-input" id="subShort" maxlength="120">
      <div class="ed-err" data-err-for="short"></div>
    </div>

    <div class="ed-field">
      <label class="ed-label" for="subDescription">Description</label>
      <textarea class="ed-textarea" id="subDescription" maxlength="500" rows="4"></textarea>
      <div class="ed-charcount"><span id="subDescCount">0</span>/500</div>
      <div class="ed-err" data-err-for="description"></div>
    </div>

    <div class="ed-field">
      <label class="ed-label">Signature items <span class="ed-label-sub">up to 3, shown as "Try this"</span></label>
      <div class="ed-sig-list" id="subSigList">${sigRowsHtml}</div>
      <div class="ed-err" data-err-for="signature"></div>
    </div>

    <div class="ed-field">
      <label class="ed-label">Hours</label>
      <div class="ed-hours" id="subHours">${hoursRowsHtml}</div>
      <div class="ed-err" data-err-for="hours"></div>
    </div>

    <div class="ed-field">
      <label class="ed-label" for="subPhone">Phone</label>
      <input type="tel" class="ed-input" id="subPhone" placeholder="020 5236 6087">
      <div class="ed-hint" id="subPhonePreview"></div>
      <div class="ed-err" data-err-for="contact"></div>
    </div>

    <div class="ed-field">
      <label class="ed-label" for="subParkingNote">Parking note</label>
      <input type="text" class="ed-input" id="subParkingNote" maxlength="60" placeholder="e.g. free lot behind the building">
      <div class="ed-err" data-err-for="parking"></div>
    </div>

    <div class="ed-field">
      <label class="ed-label" for="subFacebook">Facebook link</label>
      <input type="url" class="ed-input" id="subFacebook" placeholder="https://facebook.com/...">
      <div class="ed-err" data-err-for="links"></div>
    </div>
    <div class="ed-field">
      <label class="ed-label" for="subWebsite">Website</label>
      <input type="url" class="ed-input" id="subWebsite" placeholder="https://...">
    </div>
    <div class="ed-field">
      <label class="ed-label" for="subMapsUrl">Google Maps link <span class="ed-label-sub">required</span></label>
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
    saveBtn.textContent = 'Submitting…';
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
  state.sheetView = { type: 'venue-edit', venueId: venue.id };

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

    <div class="ed-field">
      <label class="ed-label" for="edName">Name</label>
      <input type="text" class="ed-input" id="edName" value="${esc(venue.name)}" maxlength="100">
      <div class="ed-err" data-err-for="name"></div>
    </div>
    <div class="ed-field">
      <label class="ed-label" for="edShortName">Short name</label>
      <input type="text" class="ed-input" id="edShortName" value="${esc(venue.short_name || '')}" maxlength="40">
      <div class="ed-err" data-err-for="short_name"></div>
    </div>
    <div class="ed-field">
      <label class="ed-label" for="edNameLo">Lao name</label>
      <input type="text" class="ed-input lao" id="edNameLo" value="${esc(venue.name_lo || '')}" maxlength="60">
      <div class="ed-err" data-err-for="name_lo"></div>
    </div>

    <div class="ed-field">
      <label class="ed-label">Type</label>
      <div class="seg ed-type-seg" id="edTypeSeg">
        <button type="button" class="seg-btn ed-type-btn ${venue.type==='bar'?'on':''}" data-type="bar">Bar</button>
        <button type="button" class="seg-btn ed-type-btn ${venue.type==='cafe'?'on':''}" data-type="cafe">Café</button>
        <button type="button" class="seg-btn ed-type-btn ${venue.type==='venue'?'on':''}" data-type="venue">Venue</button>
      </div>
      <div class="ed-err" data-err-for="type"></div>
    </div>

    <div class="ed-field">
      <label class="ed-label" for="edArea">Area</label>
      <input type="text" class="ed-input" id="edArea" value="${esc(venue.area || '')}" maxlength="80">
      <div class="ed-err" data-err-for="area"></div>
    </div>

    <div class="ed-field">
      <label class="ed-label" for="edShort">Short tagline</label>
      <input type="text" class="ed-input" id="edShort" value="${esc(venue.short || '')}" maxlength="120">
      <div class="ed-err" data-err-for="short"></div>
    </div>

    <div class="ed-field">
      <label class="ed-label" for="edDescription">Description</label>
      <textarea class="ed-textarea" id="edDescription" maxlength="500" rows="4">${esc(venue.description || '')}</textarea>
      <div class="ed-charcount"><span id="edDescCount">${descLen}</span>/500</div>
      <div class="ed-err" data-err-for="description"></div>
    </div>

    <div class="ed-field">
      <label class="ed-label">Signature items <span class="ed-label-sub">up to 3, shown as "Try this"</span></label>
      <div class="ed-sig-list" id="edSigList">${sigRowsHtml}</div>
      <div class="ed-err" data-err-for="signature"></div>
    </div>

    <div class="ed-field" id="edPhotoField">
      <label class="ed-label">Photos</label>
      <div class="ed-photo-nudge" id="edPhotoNudge" hidden>
        <span>Add a few photos so people know what to expect</span>
        <button type="button" class="ed-photo-nudge-close" id="edPhotoNudgeClose" aria-label="Dismiss">×</button>
      </div>
      <div class="ed-photos" id="edPhotos"></div>
      <input type="file" id="edPhotoFile" accept="image/*" hidden>
      <button type="button" class="ed-photo-add" id="edPhotoAddBtn">+ Add photo</button>
      <div class="ed-photo-progress" id="edPhotoProgress" hidden>
        <div class="ed-photo-progress-track"><div class="ed-photo-progress-bar" id="edPhotoProgressBar"></div></div>
        <div class="ed-photo-progress-label" id="edPhotoProgressLabel">Uploading… 0%</div>
      </div>
      <div class="ed-err" data-err-for="upload"></div>
    </div>

    <div class="ed-field">
      <label class="ed-label">Hours</label>
      <div class="ed-hours" id="edHours">${hoursRowsHtml}</div>
      <div class="ed-err" data-err-for="hours"></div>
    </div>

    <div class="ed-field">
      <label class="ed-label" for="edPhone">Phone</label>
      <input type="tel" class="ed-input" id="edPhone" value="${esc(contact.phone_display || '')}" placeholder="020 5236 6087">
      <div class="ed-hint" id="edPhonePreview">${contact.phone ? 'Saves as ' + esc(contact.phone) : ''}</div>
      <div class="ed-err" data-err-for="contact"></div>
    </div>

    <div class="ed-field">
      <label class="ed-label" for="edParkingNote">Parking note</label>
      <input type="text" class="ed-input" id="edParkingNote" value="${esc(parking.note || '')}" maxlength="60" placeholder="e.g. free lot behind the building">
      <div class="ed-err" data-err-for="parking"></div>
    </div>

    <div class="ed-field">
      <label class="ed-label" for="edFacebook">Facebook link</label>
      <input type="url" class="ed-input" id="edFacebook" value="${esc(links.facebook || '')}" placeholder="https://facebook.com/...">
      <div class="ed-err" data-err-for="links"></div>
    </div>
    <div class="ed-field">
      <label class="ed-label" for="edWebsite">Website</label>
      <input type="url" class="ed-input" id="edWebsite" value="${esc(links.website || '')}" placeholder="https://...">
    </div>
    <div class="ed-field">
      <label class="ed-label" for="edMapsUrl">Google Maps link</label>
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
    saveBtn.textContent = 'Saving…';
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
      saveNote.textContent = data.location_review
        ? "Thanks — we'll check the pin against your map link."
        : 'Saved.';
    } catch (e) {
      saveNote.hidden = false;
      saveNote.className = 'ed-save-note ed-save-note-error';
      saveNote.textContent = 'Connection error — try again.';
      saveBtn.textContent = 'Save';
      saveBtn.disabled = false;
    }
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

  // attaches an already-uploaded Cloudinary URL to the venue; split out so
  // a failed PATCH (upload succeeded, save didn't) can be retried without
  // re-uploading the file
  async function attachPhoto(url) {
    const res = await fetch(`/api/venues/${encodeURIComponent(venue.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photos: photosState.concat(url) }),
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

  function showRetry(message, url) {
    uploadErr.innerHTML = `${esc(message)} — <button type="button" class="ed-photo-retry" id="edPhotoRetryBtn">Retry</button>`;
    uploadErr.querySelector('#edPhotoRetryBtn').addEventListener('click', async () => {
      uploadErr.textContent = 'Saving…';
      try {
        await attachPhoto(url);
        uploadErr.textContent = '';
      } catch (e) {
        showRetry(e.message || 'could not save the photo', url);
      }
    });
  }

  addBtn.addEventListener('click', () => {
    uploadErr.textContent = '';
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    uploadErr.textContent = '';

    if (!file.type.startsWith('image/')) { uploadErr.textContent = 'images only'; return; }
    if (file.size > MAX_PHOTO_BYTES) { uploadErr.textContent = 'max 8MB per photo'; return; }

    addBtn.disabled = true;
    progressWrap.hidden = false;
    progressBar.style.width = '0%';
    progressLabel.textContent = 'Uploading… 0%';

    let uploadedUrl = null;
    try {
      const sigRes = await fetch('/api/upload-signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_id: venue.id }),
      });
      const sig = await sigRes.json().catch(() => null);
      if (!sig || !sig.ok) throw new Error(sig?.error || 'could not start upload');

      const form = new FormData();
      form.append('file', file);
      form.append('api_key', sig.api_key);
      form.append('timestamp', sig.timestamp);
      form.append('signature', sig.signature);
      form.append('folder', sig.folder);
      form.append('allowed_formats', sig.allowed_formats);
      form.append('max_file_size', sig.max_file_size);

      const uploadResult = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `https://api.cloudinary.com/v1_1/${sig.cloud_name}/image/upload`);
        xhr.upload.addEventListener('progress', (e) => {
          if (!e.lengthComputable) return;
          const pct = Math.round((e.loaded / e.total) * 100);
          progressBar.style.width = pct + '%';
          progressLabel.textContent = `Uploading… ${pct}%`;
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

      uploadedUrl = `https://res.cloudinary.com/${sig.cloud_name}/image/upload/w_1200/v${uploadResult.version}/${uploadResult.public_id}.${uploadResult.format}`;
      progressLabel.textContent = 'Saving…';
      await attachPhoto(uploadedUrl);
    } catch (e) {
      if (uploadedUrl) {
        // the file is already sitting in Cloudinary at this point — no need
        // to re-upload, just retry attaching it to the venue
        showRetry(e.message || 'could not save the photo', uploadedUrl);
      } else {
        uploadErr.textContent = e.message || 'upload failed — try again';
      }
    } finally {
      progressWrap.hidden = true;
      refreshAddBtn();
    }
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
  if (!v.hours) return { open: false, label: 'hours unconfirmed' };
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
  if (mins < t.open) return { open: false, label: `opens ${fmtTime(t.open)}` };
  if (mins < Math.min(t.close, 1440) || t.close > 1440) {
    return { open: true, label: `open until ${fmtTime(t.close % 1440)}` };
  }
  return { open: false, label: 'closed' };
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
    ? `<img class="thumb" src="${esc(cloudinaryResize(photo, 200))}" alt="" loading="lazy">`
    : `<div class="thumb thumb-ph" style="color:var(--${v.type === 'cafe' ? 'teal' : v.type === 'bar' ? 'flame' : 'violet'});">${esc((v.short_name || v.name).charAt(0))}</div>`;
  return `<div class="hcard" data-open-venue="${v.id}">
    ${thumb}
    <div>
      <div style="font-size:12.5px;font-weight:700;">${esc(v.short_name || v.name)}</div>
      <div class="hc-sub" style="font-size:11px;color:var(--mute);">${esc(sub)}</div>
      ${sub2 ? `<div class="hc-sub" style="font-size:10.5px;color:var(--dim);">${esc(sub2)}</div>` : ''}
    </div>
  </div>`;
}

// full-width photo-led card (Tonight, On fire): 16:9 photo, bold name,
// one status/distance sub-line beneath, whole card tappable
function bigCard(v, sub, photoOverride) {
  const photo = photoOverride || ((v.photos && v.photos.length) ? v.photos[0] : null);
  const media = photo
    ? `<img class="big-thumb" src="${esc(photo)}" alt="" loading="lazy">`
    : `<div class="big-thumb thumb-ph" style="color:var(--${v.type === 'cafe' ? 'teal' : v.type === 'bar' ? 'flame' : 'violet'});">${esc((v.short_name || v.name).charAt(0))}</div>`;
  return `<div class="card card-big" data-open-venue="${v.id}">
    ${media}
    <div class="card-body">
      <div style="font-size:15px;font-weight:700;">${esc(v.short_name || v.name)}</div>
      <div class="t-sub">${sub}</div>
    </div>
  </div>`;
}

/* ---------- Cloudinary URLs: request the size a slot actually renders at */
// every stored photo URL requests w_1200 regardless of where it's used —
// rewrites that one transform segment to the width the calling slot needs
// (plus dpr_auto for retina) rather than storing multiple URLs per photo.
// No-ops on anything that isn't in the expected .../upload/w_1200,.../shape,
// so a differently-hosted or already-rewritten URL just passes through.
function cloudinaryResize(url, width) {
  if (typeof url !== 'string') return url;
  return url.replace(/w_1200(?=,|\/)/, `w_${width},dpr_auto`);
}

/* ---------- photo load failures: fall back to the monogram tile ---------- */
// letter-tile matching .thumb-ph's look (colour-by-type letter on a themed
// background) — reused as the onerror/timeout fallback for any venue <img>
// so a photo that fails to load reads the same as "no photos at all"
// instead of a blank grey box
function venueMonogramSvgUri(v) {
  const letter = (v.short_name || v.name).charAt(0).toUpperCase();
  const fgVar = v.type === 'cafe' ? '--teal' : v.type === 'bar' ? '--flame' : '--violet';
  const cs = getComputedStyle(document.documentElement);
  const fg = cs.getPropertyValue(fgVar).trim() || '#8A8494';
  // .thumb-ph's light theme swaps in a hardcoded background rather than a
  // shared token (see style.css) — keep this hex in sync with that rule
  const bg = state.theme === 'light' ? '#DFD4BC' : (cs.getPropertyValue('--ink3').trim() || '#241E31');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">` +
    `<rect width="240" height="240" fill="${bg}"/>` +
    `<text x="120" y="128" text-anchor="middle" font-family="Space Grotesk, sans-serif" ` +
    `font-weight="700" font-size="104" fill="${fg}">${esc(letter)}</text></svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
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
    if (!ok) {
      console.warn('[muan] image failed to load:', img.src);
      img.dataset.monogram = '1';
      img.onerror = null;
      img.src = venueMonogramSvgUri(v);
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
// (already width-rewritten, see cloudinaryResize()) photo URL, then arms
// the load/error/timeout fallback for those real requests — called once per
// card, when observeCollageCards() decides it's actually time to load it
function loadCollageCardPhotos(cardEl, v) {
  cardEl.querySelectorAll('img[data-src]').forEach(img => {
    img.src = img.dataset.src;
    delete img.dataset.src;
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
// "closed" / "hours unconfirmed"); only the not-yet-open case ("opens 10 am")
// needs a "closed ·" prefix to read honestly at a glance
function collageStatusLine(v) {
  const st = openStatus(v);
  const statusPart = (st.open || /^closed/.test(st.label) || st.label === 'hours unconfirmed')
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
  if (!photos.length) return `<div class="collage-photos collage-photos-empty">📷</div>`;
  const placeholder = venueMonogramSvgUri(v);
  const n = Math.min(photos.length, 3);
  const extra = photos.length - 3;
  let html = `<div class="collage-photos">`;
  html += `<div class="collage-tile collage-tile-big${n === 1 ? ' solo' : ''}">
    <img src="${placeholder}" data-src="${esc(cloudinaryResize(photos[0], 600))}" alt="${esc(altName)}" loading="lazy" draggable="false"></div>`;
  if (n >= 2) {
    const more = n >= 3 && extra > 0 ? extra : null;
    html += `<div class="collage-row">
      <div class="collage-tile"><img src="${placeholder}" data-src="${esc(cloudinaryResize(photos[1], 300))}" alt="" loading="lazy" draggable="false"></div>
      ${n >= 3 ? `<div class="collage-tile">
        <img src="${placeholder}" data-src="${esc(cloudinaryResize(photos[2], 300))}" alt="" loading="lazy" draggable="false">
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
  return `
    <div class="collage-card" data-open-venue="${v.id}">
      ${collagePhotosHtml(v, v.name)}
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

function renderHomeSheet() {
  state.selectedId = null; if (state.map) updateSelection();
  state.sheetView = { type: 'home', venueId: null };
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
      <div class="s-sub lao">${sub}</div>`;
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
      const cafeGallery = state.venues
        .filter(v => v.type === 'cafe' && v.pin_status !== 'pending' && (v.photos?.length || 0) >= 2)
        .sort((a, b) => (b.photos.length - a.photos.length) ||
          (a.short_name || a.name).localeCompare(b.short_name || b.name));
      if (!cafeGallery.length) {
        html += `<div class="sec-empty"><div class="sec-empty-ico" data-empty-svg></div>Nothing here right now — try another filter.</div>`;
      } else {
        html += cafeGallery.map(v => collageCardHtml(v)).join('');
      }
    } else {
      const typeVenues = state.venues.filter(v => v.type === f)
        .sort((a, b) => (a.short_name || a.name).localeCompare(b.short_name || b.name));
      if (!typeVenues.length) {
        html += `<div class="sec-empty"><div class="sec-empty-ico" data-empty-svg></div>Nothing here right now — try another filter.</div>`;
      } else {
        for (const v of typeVenues) {
          const st = openStatus(v);
          html += `
            <div class="card" data-open-venue="${v.id}">
              ${(v.photos && v.photos.length) ? `<img class="thumb" src="${esc(cloudinaryResize(v.photos[0], 200))}" alt="" loading="lazy">` : `<div class="thumb thumb-ph" style="color:var(--${color});">${esc((v.short_name || v.name).charAt(0))}</div>`}
              <div class="card-body">
                <div class="row">
                  <span style="font-size:13.5px;font-weight:700;">${esc(v.short_name || v.name)}</span>
                  <span class="tag ${st.open ? 'open' : 'closed'}">${st.open ? '● OPEN' : ''}</span>
                </div>
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
    <div class="s-sub lao">${sub}</div>`;
  let rendered = false;

  if (showEvents && tonight.length) {
    rendered = true;
    html += secH('violet', 'Tonight · ຄືນນີ້');
    for (const ev of tonight) {
      const v = venueById(ev.venue_id);
      const evLine = `${ev.start_time ? fmtTime(toMins(ev.start_time)) + ' · ' : ''}${fmtPrice(ev.price)}`;
      if (!v) {
        const media = ev.photo
          ? `<img class="big-thumb" src="${esc(ev.photo)}" alt="" loading="lazy">`
          : `<div class="big-thumb thumb-ph" style="color:var(--mute);">${esc(ev.title.charAt(0))}</div>`;
        html += `
          <div class="card card-big">
            ${media}
            <div class="card-body">
              <div style="font-size:15px;font-weight:700;">${esc(ev.title)}</div>
              <div class="t-sub">${evLine}${ev.short ? ' · ' + esc(ev.short) : ''}${ev.verified ? '' : ' · unconfirmed'}</div>
            </div>
          </div>`;
        continue;
      }
      const tonightPhoto = ev.photo || ((v.photos && v.photos.length) ? v.photos[0] : null);
      const media = tonightPhoto
        ? `<img class="big-thumb" src="${esc(tonightPhoto)}" alt="" loading="lazy">`
        : `<div class="big-thumb thumb-ph" style="color:var(--violet);">${esc((v.short_name || v.name).charAt(0))}</div>`;
      html += `
        <div class="card card-big" data-open-venue="${v.id}">
          ${media}
          <div class="card-body">
            <div style="font-size:15px;font-weight:700;">${esc(ev.title)} — ${esc(v.short_name || v.name)}</div>
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

  if (showVenueSections && pickVenues.length) {
    rendered = true;
    html += secH('flame', 'On fire · ໄຟລຸກ', esc(state.picks?.note_en), miniFlame()) +
      pickVenues.map(v => bigCard(v, venueLine(v, esc(v.area || '')))).join('') +
      `<div style="font-size:10.5px;color:var(--dim);margin-top:8px;">live check-in rankings coming soon</div>`;
  }

  if (showVenueSections && busyVenues.length) {
    rendered = true;
    html += secH('flame', 'Busy spots · ບ່ອນຄົນຫຼາຍ', esc(state.picks?.busy_note_en)) +
      `<div class="hcards">` +
      busyVenues.map(v => sectionCard(v, venueLine(v, esc(v.area || '')))).join('') + `</div>
      <div style="font-size:10.5px;color:var(--dim);margin-top:8px;">our picks for now — live counts when check-ins launch</div>`;
  }

  if (showEvents && upcoming.length) {
    rendered = true;
    html += secH('violet', 'Coming up · ອີເວັນຕໍ່ໄປ') + `<div class="hcards">` +
      upcoming.map(ev => {
        const v = venueById(ev.venue_id);
        if (!v) {
          return `<div class="hcard">
            ${ev.photo ? `<img class="thumb" src="${esc(cloudinaryResize(ev.photo, 200))}" alt="" loading="lazy">` : `<div class="thumb thumb-ph" style="color:var(--mute);">${esc(ev.title.charAt(0))}</div>`}
            <div>
              <div style="font-size:12.5px;font-weight:700;">${esc(ev.title)}</div>
              <div class="hc-sub" style="font-size:11px;color:var(--mute);">${fmtDate(ev.date)}${ev.short ? ' · ' + esc(ev.short) : ''}</div>
            </div>
          </div>`;
        }
        return sectionCard(v, `${fmtDate(ev.date)} · ${esc(ev.title)}`, ev.photo, venueLine(v, ''));
      }).join('') + `</div>`;
  }

  if (showVenueSections && openingSoon.length) {
    rendered = true;
    html += secH('violet', 'Opening soon · ກຳລັງຈະເປີດ') + `<div class="hcards">` +
      openingSoon.map(v => sectionCard(v, venueLine(v, esc(v.area || '')))).join('') + `</div>`;
  }

  if (showVenueSections && late.length) {
    rendered = true;
    html += secH('teal', 'Open late · ເປີດເດິກ') + `<div class="hcards">` +
      late.map(v => sectionCard(v, venueLine(v, openStatus(v).label))).join('') + `</div>`;
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
  toggleSheet(false);
  if (!state.userPos) warmLocation();  // so Directions usually has a fix already — see warmLocation()
  // a route only dies when a DIFFERENT venue opens — reopening the routed
  // venue itself (e.g. sticky re-open from goHome()) must keep it (see #4)
  if (state.routeVenueId && state.routeVenueId !== id) clearRoute();
  const hasStickyRoute = state.routeVenueId === id && !!state.currentRouteGeometry;
  state.selectedId = id; updateSelection();
  state.sheetView = { type: 'venue', venueId: id };
  const st = openStatus(v);
  const evs = venueEvents(id);
  // owner-submitted venue awaiting Kar's pin (migrations/009_pin_status.sql)
  // — no confirmed lat/lng, so no check-in, no Directions, no distance
  const isPending = v.pin_status === 'pending';

  const photos = v.photos || [];
  let galleryHtml;
  if (!photos.length) {
    galleryHtml = `<div class="ph-empty"><span>📷</span> photos coming soon · <span class="lao">ຮູບກຳລັງມາ</span></div>`;
  } else {
    galleryHtml = `
      <div class="gal">
        <img class="gal-hero" id="galHero" src="${esc(cloudinaryResize(photos[0], 900))}" alt="${esc(v.name)}" loading="lazy">
        ${photos.length > 1 ? `<div class="gal-thumbs">` +
          photos.map((p, i) =>
            `<img class="gal-thumb ${i===0?'sel':''}" src="${esc(cloudinaryResize(p, 200))}" data-gi="${i}" alt="" loading="lazy">`
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
        <span style="color:var(--${st.open ? 'teal' : 'dim'});font-weight:700;">${st.label}</span>
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
  history.replaceState(null, '', '?v=' + v.id);
  document.querySelectorAll('.gal-hero, .gal-thumb').forEach(img => watchImgLoad(img, v));
  document.querySelectorAll('.gal-thumb').forEach(t => t.addEventListener('click', () => {
    const hero = document.getElementById('galHero');
    hero.classList.add('fading');
    setTimeout(() => {
      hero.src = cloudinaryResize(photos[+t.dataset.gi], 900);
      hero.onload = () => hero.classList.remove('fading');
      watchImgLoad(hero, v);   // re-arm for the newly-swapped-in photo
    }, 140);
    document.querySelectorAll('.gal-thumb').forEach(x => x.classList.remove('sel'));
    t.classList.add('sel');
  }));
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

  lbl.textContent = 'Finding route…';
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
// sheet closing, the home sheet re-rendering, or the sheet collapsing
function showRouteBar(label) {
  const bar = document.getElementById('routeBar');
  document.getElementById('routeBarLabel').textContent = label;
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
  const canDrag = (e, sheet) => {
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
    inner.classList.remove('settling');
    inner.style.transform = `translateX(${dir * W * 0.35}px)`;
    inner.style.opacity = '0';
    requestAnimationFrame(() => {
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
  // #sheetHandle and chipBar are persistent siblings of #sheetInner (see
  // index.html / placeChips()) — only #sheetInner's content is replaced, so
  // a horizontal filter-swipe can animate it without fighting the sheet's
  // own vertical scroll/collapse transform.
  const inner = document.getElementById('sheetInner');
  inner.innerHTML = html;
  // undo any in-progress swipe animation left over from changeFilterAnimated()
  inner.classList.remove('swiping', 'settling');
  inner.style.transform = '';
  inner.style.opacity = '';
  inner.classList.remove('anim');
  void inner.offsetWidth;
  inner.classList.add('anim');
  inner.querySelectorAll('[data-open-venue]').forEach(el =>
    el.addEventListener('click', () => openVenue(el.dataset.openVenue)));
  inner.querySelectorAll('[data-cafe-tab]').forEach(el =>
    el.addEventListener('click', () => {
      state.cafeTab = el.dataset.cafeTab;
      renderHomeSheet();
    }));
  inner.querySelectorAll('[data-home]').forEach(el =>
    el.addEventListener('click', () => {
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
