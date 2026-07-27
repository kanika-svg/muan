/* ============================================================
   Muan — phase 1
   Map + curated venues/events. No accounts, no check-ins yet.
   Check-ins, streaks and badges arrive in phase 2 (Workers + D1).
   ============================================================ */

const COLORS = { bar: 'var(--pin-bar)', cafe: 'var(--pin-cafe)', event: 'var(--pin-venue)', venue: 'var(--pin-venue)' };
const VIENTIANE = { lng: 102.6030, lat: 17.9630 };
/* normal map fence — initMap() sets these, clearRoute() restores them after a
   route temporarily lifts the fence */
const MAP_BOUNDS = { maxBounds: [[102.49, 17.88], [102.75, 18.05]], minZoom: 12.4 };
const GOOGLE_CLIENT_ID = '768624583305-553qrbhib2mqbbi10ifsr18b8uqu4uvk.apps.googleusercontent.com';

const state = {
  venues: [],
  events: [],
  picks: null,
  filter: 'all',
  markers: [],
  clusterMarkers: [],
  userPos: null,
  userMarker: null,
  currentRouteGeometry: null,
  map: null,
  selectedId: null,
  theme: null,
  tracking: null,
  trackWatchId: null,
};

/* ---------- boot ---------- */
async function boot() {
  const [vRes, eRes, pRes] = await Promise.all([
    fetch('data/venues.json'),
    fetch('data/events.json'),
    fetch('data/picks.json'),
  ]);
  state.venues = (await vRes.json()).venues;
  state.events = (await eRes.json()).events.filter(ev => !isPast(ev.date));
  state.picks = await pRes.json();

  applyTheme();
  bindTheme();
  refreshAvatarBtn();
  document.getElementById('avatarBtn').addEventListener('click', openFlameSheet);
  initMap();
  renderHomeSheet();
  bindChips();
  bindLocate();
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
    if (state.map) state.map.flyTo({ center: [venueById(vid).lng, venueById(vid).lat], zoom: 15.5 });
  }
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

function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  document.getElementById('themeLabel').textContent =
    (localStorage.getItem('muan-theme') || 'auto') === 'auto' ? 'auto' : theme;
  if (state.map && state.theme !== theme) state.map.setStyle(mapStyle(theme));
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

/* three independently-flickering layers so the flame never looks looped;
   mid/core are scaled about the flame's base point (60,132), not its centre,
   via a wrapping <g> transform — kept off the animated element so the CSS
   flicker keyframes (which also target transform) don't wipe it out every frame */
const FLAME_PATH_D = "M60 6 C48 30 24 44 24 82 C24 112 40 132 60 132 C80 132 96 112 96 82 C96 60 84 48 78 34 C74 46 68 50 64 48 C68 34 66 20 60 6 Z";
function flameStackSVG() {
  return `<svg viewBox="0 0 120 140" width="110" height="128">
    <defs><linearGradient id="flg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFC24B"/><stop offset=".55" stop-color="#FF5A3C"/><stop offset="1" stop-color="#C6432A"/>
    </linearGradient></defs>
    <g class="flame-stack">
      <path class="flame-outer" d="${FLAME_PATH_D}" fill="url(#flg)"/>
      <g transform="translate(60,132) scale(.72) translate(-60,-132)">
        <path class="flame-mid" d="${FLAME_PATH_D}" fill="#FF7A2E"/>
      </g>
      <g transform="translate(60,132) scale(.42) translate(-60,-132)">
        <path class="flame-core" d="${FLAME_PATH_D}" fill="#FFD86B"/>
      </g>
    </g>
  </svg>`;
}

async function openFlameSheet() {
  setSheet('<div class="s-sub" style="text-align:center;padding:30px 0;">Loading your flame…</div>');
  let me = null;
  try { me = await (await fetch('/api/me')).json(); } catch(e) {}
  if (!me || !me.ok) { setSheet('<div class="s-sub" style="text-align:center;padding:30px 0;">Could not load — try again.</div>'); return; }

  if (me.signed_out) {
    setSheet(`
      <div class="fl-wrap">
        <div class="fl-flame" style="opacity:.4;">
          ${flameStackSVG()}
        </div>
        <div class="fl-stage">Your flame starts here</div>
        <div class="fl-sub">Sign in to check in, keep streaks and earn embers</div>
        <div id="gsi-btn" style="display:flex;justify-content:center;margin:18px 0;"></div>
        <div class="btn-row"><button class="btn btn-back" data-home style="flex:1;">Done</button></div>
      </div>
    `);
    initGoogleSignIn('gsi-btn');
    return;
  }

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
        ${flameStackSVG()}
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
  document.querySelector('[data-open-avatar]')?.addEventListener('click', openAvatarSheet);
  document.querySelector('[data-sign-out]')?.addEventListener('click', signOut);
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
  state.map.on('load', () => {
    state.map.resize();
    requestAnimationFrame(() => {
      state.map.resize();
      renderMarkers();
      if (state.venues.length > 1) {
        const b = new maplibregl.LngLatBounds();
        state.venues.forEach(v => b.extend([v.lng, v.lat]));
        state.map.fitBounds(b, { padding: { top: 90, bottom: 60, left: 70, right: 70 }, maxZoom: 14.5 });
      }
    });
  });
  state.map.on('zoom', () => {
    document.getElementById('map').classList.toggle('labels-hidden', state.map.getZoom() < 12.2);
    document.getElementById('map').classList.toggle('labels-thin', state.map.getZoom() < 12.8);
    document.getElementById('map').classList.toggle('zoomed-close', state.map.getZoom() >= 15.5);
  });
  state.map.on('zoomend', () => { updateClusters(); updateLabelCrowding(); });
  state.map.on('moveend', () => { updateClusters(); updateLabelCrowding(); });
  state.map.on('click', (e) => {
    if (e.originalEvent.target.closest('.marker')) return;
    if (e.originalEvent.target.closest('.cluster')) return;
    if (state.selectedId) { stopTracking(); renderHomeSheet(); }
    if (window.innerWidth < 768) toggleSheet(true);
  });
}

function pinSVG(color, scale, variant) {
  const s = 30 * scale;
  const dot = variant === 'event'
    ? `<circle class="pin-dot" cx="62" cy="15" r="5" fill="var(--flame)" stroke="var(--ink)" stroke-width="2">
      <animate attributeName="r" values="5;6.2;5" dur="2.4s" repeatCount="indefinite"/>
    </circle>`
    : variant === 'pick'
    ? `<circle class="pin-dot" cx="62" cy="15" r="5" fill="var(--gold)" stroke="var(--ink)" stroke-width="2"/>`
    : '';
  return `<svg width="${s}" height="${s * 1.2}" viewBox="0 0 72 88">
    <path d="M36 4 C18 4 6 17 6 33 C6 52 26 70 36 84 C46 70 66 52 66 33 C66 17 54 4 36 4 Z" fill="${color}"/>
    <circle cx="36" cy="32" r="13" fill="#131019"/>
    ${dot}
  </svg>`;
}

function renderMarkers() {
  state.markers.forEach(m => m.marker.remove());
  state.markers = [];

  const visible = state.venues.filter(v =>
    state.filter === 'all' ||
    v.type === state.filter ||
    (state.filter === 'event' && venueEvents(v.id).length > 0)
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
  updateClusters();
  updateLabelCrowding();
  updateSelection();
}

/* priority order shared by the cluster pass and the label pass, highest first */
function labelPriorityRank(m) {
  if (m.hasEventToday) return 0;
  if (m.isPick) return 1;
  if (openStatus(m.venue).open) return 2;
  if (Array.isArray(m.venue.photos) && m.venue.photos.length > 0) return 3;
  return 4;
}

function sortByLabelPriority(markers) {
  return [...markers].sort((a, b) => {
    const r = labelPriorityRank(a) - labelPriorityRank(b);
    return r !== 0 ? r : a.venue.name.localeCompare(b.venue.name);
  });
}

const CLUSTER_PX = 40;

/* groups pins that sit within CLUSTER_PX of each other on screen, walking
   them in the same priority order the label pass uses. runs before the
   label pass so crowded labels are only computed for surviving markers. */
function updateClusters() {
  /* remove the whole pool up front — stale cluster markers are the likely leak here */
  state.clusterMarkers.forEach(cm => cm.remove());
  state.clusterMarkers = [];
  state.markers.forEach(m => m.el.classList.remove('in-cluster'));

  const sorted = sortByLabelPriority(state.markers);
  const points = new Map(sorted.map(m => [m, state.map.project([m.venue.lng, m.venue.lat])]));

  const grouped = new Set();
  for (const leader of sorted) {
    if (grouped.has(leader)) continue;
    const group = [leader];
    grouped.add(leader);
    const lp = points.get(leader);
    for (const other of sorted) {
      if (grouped.has(other)) continue;
      const op = points.get(other);
      if (Math.hypot(op.x - lp.x, op.y - lp.y) <= CLUSTER_PX) {
        group.push(other);
        grouped.add(other);
      }
    }
    if (group.length < 2) continue;

    group.forEach(m => m.el.classList.add('in-cluster'));

    const members = group.map(m => m.venue);
    const centroidLng = members.reduce((s, v) => s + v.lng, 0) / members.length;
    const centroidLat = members.reduce((s, v) => s + v.lat, 0) / members.length;
    const hasEvent = group.some(m => m.hasEventToday);

    const el = document.createElement('div');
    el.className = 'cluster' + (hasEvent ? ' has-event' : '');
    el.textContent = String(group.length);
    el.addEventListener('click', () => {
      const b = new maplibregl.LngLatBounds();
      members.forEach(v => b.extend([v.lng, v.lat]));
      state.map.fitBounds(b, { padding: 80, maxZoom: 17 });
    });

    const clusterMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([centroidLng, centroidLat])
      .addTo(state.map);
    state.clusterMarkers.push(clusterMarker);
  }
}

function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/* walks surviving (non-clustered) markers highest-priority first, keeping a
   label unless its rect collides with an already-kept label's rect. re-run
   on zoom/move end since screen-space rects shift as the map view changes. */
function updateLabelCrowding() {
  state.markers.forEach(m => m.el.classList.remove('label-crowded'));

  const eligible = state.markers.filter(m => !m.el.classList.contains('in-cluster'));
  const sorted = sortByLabelPriority(eligible);

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
    return { open: true, label: `open · until ${fmtTime(y.close - 1440)}` };
  }
  const t = parseHours(v.hours[today]);
  if (!t) return { open: false, label: 'closed today' };
  if (mins < t.open) return { open: false, label: `opens ${fmtTime(t.open)}` };
  if (mins < Math.min(t.close, 1440) || t.close > 1440) {
    return { open: true, label: `open · until ${fmtTime(t.close % 1440)}` };
  }
  return { open: false, label: 'closed' };
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

function sectionCard(v, sub) {
  const thumb = (v.photos && v.photos.length)
    ? `<img class="thumb" src="${esc(v.photos[0])}" alt="" loading="lazy">`
    : `<div class="thumb thumb-ph" style="color:var(--${v.type === 'cafe' ? 'teal' : v.type === 'bar' ? 'flame' : 'violet'});">${esc((v.short_name || v.name).charAt(0))}</div>`;
  return `<div class="hcard" data-open-venue="${v.id}">
    ${thumb}
    <div>
      <div style="font-size:12.5px;font-weight:700;">${esc(v.short_name || v.name)}</div>
      <div style="font-size:11px;color:var(--mute);">${esc(sub)}</div>
    </div>
  </div>`;
}

function renderHomeSheet() {
  state.selectedId = null; if (state.map) updateSelection();
  if (state.map) clearRoute();
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
  const pickVenues = (state.picks?.venue_ids || []).map(venueById).filter(Boolean).filter(matchType);
  const busyVenues = (state.picks?.busy_venue_ids || []).map(venueById).filter(Boolean).filter(matchType);
  const openingSoon = state.venues.filter(v => v.status === 'opening-soon' && matchType(v));

  const showEvents = (f === 'all' || f === 'event');
  const showVenueSections = (f !== 'event');

  const secH = (color, label, note) =>
    `<div class="sec-h"><span class="dot" style="background:var(--${color});"></span>${label}${note ? `<span class="sec-note">${note}</span>` : ''}</div>`;

  const sub = isNight() ? 'ຄືນນີ້ໄປໃສດີ?' : 'ມື້ນີ້ໄປໃສດີ?';

  if (f === 'bar' || f === 'cafe') {
    const color = f === 'bar' ? 'flame' : 'teal';
    const label = f === 'bar' ? 'Bars · ບາຣ໌' : 'Cafes · ຄາເຟ';
    const typeVenues = state.venues.filter(v => v.type === f)
      .sort((a, b) => (a.short_name || a.name).localeCompare(b.short_name || b.name));
    let html = `
      <div class="s-title">${dayGreeting()}, Vientiane</div>
      <div class="s-sub lao">${sub}</div>`;
    html += secH(color, label);
    if (!typeVenues.length) {
      html += `<div class="sec-empty">Nothing here right now — try another filter.</div>`;
    } else {
      for (const v of typeVenues) {
        const st = openStatus(v);
        html += `
          <div class="card" data-open-venue="${v.id}">
            ${(v.photos && v.photos.length) ? `<img class="thumb" src="${esc(v.photos[0])}" alt="" loading="lazy">` : `<div class="thumb thumb-ph" style="color:var(--${color});">${esc((v.short_name || v.name).charAt(0))}</div>`}
            <div class="card-body">
              <div class="row">
                <span style="font-size:13.5px;font-weight:700;">${esc(v.short_name || v.name)}</span>
                <span class="tag ${st.open ? 'open' : 'closed'}">${st.open ? '● OPEN' : ''}</span>
              </div>
              <div class="t-sub">${esc(v.area || '')}${v.area ? ' · ' : ''}${st.label}</div>
            </div>
          </div>`;
      }
    }
    setSheet(html);
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
      if (!v) {
        html += `
          <div class="card">
            <div class="thumb thumb-ph" style="color:var(--mute);">${esc(ev.title.charAt(0))}</div>
            <div class="card-body">
              <div class="row">
                <span style="font-size:13.5px;font-weight:700;">${esc(ev.title)}</span>
              </div>
              <div class="t-sub">${ev.start_time ? fmtTime(toMins(ev.start_time)) + ' · ' : ''}${fmtPrice(ev.price)}${ev.short ? ' · ' + esc(ev.short) : ''}${ev.verified ? '' : ' · unconfirmed'}</div>
            </div>
          </div>`;
        continue;
      }
      const st = openStatus(v);
      html += `
        <div class="card" data-open-venue="${v.id}">
          ${(v.photos && v.photos.length) ? `<img class="thumb" src="${esc(v.photos[0])}" alt="" loading="lazy">` : `<div class="thumb thumb-ph" style="color:var(--violet);">${esc((v.short_name || v.name).charAt(0))}</div>`}
          <div class="card-body">
            <div class="row">
              <span style="font-size:13.5px;font-weight:700;">${esc(ev.title)} — ${esc(v.short_name || v.name)}</span>
              <span class="tag ${st.open ? 'open' : 'closed'}">${st.open ? '● OPEN' : ''}</span>
            </div>
            <div class="t-sub">${ev.start_time ? fmtTime(toMins(ev.start_time)) + ' · ' : ''}${fmtPrice(ev.price)} · ${esc(v.area || '')}${ev.verified ? '' : ' · unconfirmed'}</div>
          </div>
        </div>`;
    }
  }

  if (showEvents && !tonight.length && !upcoming.length) {
    rendered = true;
    html += secH('violet', 'Tonight · ຄືນນີ້') +
      `<div class="sec-empty">Nothing verified yet — new list every Thursday.</div>`;
  }

  if (showVenueSections && pickVenues.length) {
    rendered = true;
    html += secH('flame', 'On fire · ໄຟລຸກ', esc(state.picks.note_en)) +
      `<div class="hcards">` +
      pickVenues.map(v => sectionCard(v, esc(v.area || ''))).join('') + `</div>
      <div style="font-size:10.5px;color:var(--dim);margin-top:8px;">live check-in rankings coming soon</div>`;
  }

  if (showVenueSections && busyVenues.length) {
    rendered = true;
    html += secH('flame', 'Busy spots · ບ່ອນຄົນຫຼາຍ', esc(state.picks.busy_note_en)) +
      `<div class="hcards">` +
      busyVenues.map(v => sectionCard(v, esc(v.area || ''))).join('') + `</div>
      <div style="font-size:10.5px;color:var(--dim);margin-top:8px;">our picks for now — live counts when check-ins launch</div>`;
  }

  if (showEvents && upcoming.length) {
    rendered = true;
    html += secH('violet', 'Coming up · ອີເວັນຕໍ່ໄປ') + `<div class="hcards">` +
      upcoming.map(ev => {
        const v = venueById(ev.venue_id);
        if (!v) {
          return `<div class="hcard">
            <div class="thumb thumb-ph" style="color:var(--mute);">${esc(ev.title.charAt(0))}</div>
            <div>
              <div style="font-size:12.5px;font-weight:700;">${esc(ev.title)}</div>
              <div style="font-size:11px;color:var(--mute);">${fmtDate(ev.date)}${ev.short ? ' · ' + esc(ev.short) : ''}</div>
            </div>
          </div>`;
        }
        return sectionCard(v, `${fmtDate(ev.date)} · ${esc(ev.title)}`);
      }).join('') + `</div>`;
  }

  if (showVenueSections && openingSoon.length) {
    rendered = true;
    html += secH('violet', 'Opening soon · ກຳລັງຈະເປີດ') + `<div class="hcards">` +
      openingSoon.map(v => sectionCard(v, esc(v.area || ''))).join('') + `</div>`;
  }

  if (showVenueSections && late.length) {
    rendered = true;
    html += secH('teal', 'Open late · ເປີດເດິກ') + `<div class="hcards">` +
      late.map(v => sectionCard(v, openStatus(v).label)).join('') + `</div>`;
  }


  if (!rendered) {
    html += `<div class="sec-empty">Nothing here right now — try another filter.</div>`;
  }

  setSheet(html);
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
    lbl.textContent = 'Enable location to check in';
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
  clearRoute();
  state.selectedId = id; updateSelection();
  const st = openStatus(v);
  const evs = venueEvents(id);

  const photos = v.photos || [];
  let galleryHtml;
  if (!photos.length) {
    galleryHtml = `<div class="ph-empty"><span>📷</span> photos coming soon · <span class="lao">ຮູບກຳລັງມາ</span></div>`;
  } else {
    galleryHtml = `
      <div class="gal">
        <img class="gal-hero" id="galHero" src="${esc(photos[0])}" alt="${esc(v.name)}" loading="lazy">
        ${photos.length > 1 ? `<div class="gal-thumbs">` +
          photos.map((p, i) =>
            `<img class="gal-thumb ${i===0?'sel':''}" src="${esc(p)}" data-gi="${i}" alt="" loading="lazy">`
          ).join('') + `</div>` : ''}
      </div>`;
  }

  let travel;
  if (state.userPos) {
    const m = haversine(state.userPos, v);
    const walk = Math.max(1, Math.ceil(m / 80));
    const ride = Math.max(1, Math.ceil(m / 300));
    travel = `${fmtDist(m)} away · ~${walk} min walk · ~${ride} min ride
      <div class="sub">straight-line estimate</div>`;
  } else {
    travel = `<span class="sub">tap "near me" up top to see travel time</span>`;
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
      <button class="act" id="checkinBtn" data-venue="${v.id}" disabled>
        <span class="act-ico">🔥</span><span class="act-lbl" id="checkinLabel">Check in</span>
      </button>
      <button class="act" id="dirBtn">
        <span class="act-ico">➤</span><span class="act-lbl" id="dirLbl">Directions</span>
      </button>
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
    ${v.links.facebook ? `
    <div class="v-fact">
      <div class="info-ic">📘</div>
      <div class="info-main"><a href="${esc(v.links.facebook)}" target="_blank" rel="noopener" style="color:var(--bone);">Facebook page</a></div>
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
  history.replaceState(null, '', '?v=' + v.id);
  document.querySelectorAll('.gal-thumb').forEach(t => t.addEventListener('click', () => {
    const hero = document.getElementById('galHero');
    hero.classList.add('fading');
    setTimeout(() => {
      hero.src = photos[+t.dataset.gi];
      hero.onload = () => hero.classList.remove('fading');
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

  state.map.flyTo({ center: [v.lng, v.lat], zoom: 15.5, speed: 1.4 });
}

/* on-demand road routing for the venue sheet currently open only — never for
   the whole venue list, that would burn the daily ORS quota immediately */
async function toggleRoute(v) {
  const dirBtn = document.getElementById('dirBtn');
  const lbl = document.getElementById('dirLbl');
  if (!dirBtn || !lbl) return;

  if (dirBtn.dataset.showing === '1') {
    clearRoute();
    dirBtn.dataset.showing = '';
    lbl.textContent = 'Directions';
    const attr = document.getElementById('routeAttribution');
    if (attr) attr.innerHTML = '';
    return;
  }

  if (!state.userPos) {
    lbl.textContent = 'Enable location first';
    return;
  }

  lbl.textContent = 'Loading…';
  dirBtn.disabled = true;
  try {
    const p = new URLSearchParams({
      from_lat: state.userPos.lat, from_lng: state.userPos.lng,
      to_lat: v.lat, to_lng: v.lng, mode: 'driving-car',
    });
    const data = await (await fetch('/api/route?' + p)).json();
    if (state.selectedId !== v.id) return; // sheet moved on while we waited
    dirBtn.disabled = false;
    if (!data.ok || !data.geometry) throw new Error('no route');

    const travelEl = document.getElementById('travelLine');
    if (travelEl) {
      const mins = Math.max(1, Math.round(data.duration_s / 60));
      travelEl.innerHTML = `${fmtDist(data.distance_m)} away · ${mins} min drive`;
    }
    const attr = document.getElementById('routeAttribution');
    if (attr) attr.innerHTML = '<div class="hint">routing © OpenStreetMap contributors</div>';

    // beyond this range the line on the map is unreadable and unfencing the
    // map to fit it is disorienting — the distance/time above is enough
    if (data.distance_m > 40000) {
      lbl.textContent = 'Too far to map';
    } else {
      showRoute(data.geometry);
      lbl.textContent = 'Hide route';
      dirBtn.dataset.showing = '1';
    }
  } catch (e) {
    dirBtn.disabled = false;
    lbl.textContent = 'Route unavailable';
    setTimeout(() => {
      const l = document.getElementById('dirLbl');
      if (l && l.textContent === 'Route unavailable') l.textContent = 'Directions';
    }, 2000);
  }
}

/* ---------- route drawing ---------- */
function ensureUserMarker() {
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

function showRoute(geometry) {
  ensureUserMarker();
  state.currentRouteGeometry = geometry;
  drawRouteLayers(geometry);

  // routes can run well outside the normal city fence — lift it while shown,
  // clearRoute() puts it back
  state.map.setMaxBounds(null);
  state.map.setMinZoom(9);

  // frame the whole route, leaving room for the panel
  const b = new maplibregl.LngLatBounds();
  geometry.coordinates.forEach(c => b.extend(c));
  const sheetOpen = window.innerWidth >= 768
    && !document.getElementById('sheet')?.classList.contains('collapsed');
  state.map.fitBounds(b, {
    padding: { top: 80, bottom: 80, right: 40,
               left: sheetOpen ? 460 : 40 }
  });
}

function clearRoute() {
  state.currentRouteGeometry = null;
  state.map.setMaxBounds(MAP_BOUNDS.maxBounds);
  state.map.setMinZoom(MAP_BOUNDS.minZoom);
  ['route-line', 'route-casing'].forEach(id => {
    if (state.map.getLayer(id)) state.map.removeLayer(id);
  });
  if (state.map.getSource('route')) state.map.removeSource('route');
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
  const ov = document.createElement('div');
  ov.className = 'celebrate';
  ov.innerHTML = `
    <div class="cel-card">
      <div class="cel-flame">🔥</div>
      <div class="cel-title">Checked in!</div>
      <div class="cel-venue">${esc(data.venue)}</div>
      <div class="cel-embers"><span class="cel-num" data-target="${data.embers_earned}">0</span><span class="cel-unit">embers</span></div>
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
    </div>`;
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('show'));
  fireConfetti(ov);
  // count-up
  const num = ov.querySelector('.cel-num');
  const target = +num.dataset.target;
  let n = 0;
  const step = Math.max(1, Math.round(target/20));
  const t = setInterval(() => { n = Math.min(target, n+step); num.textContent = n; if (n>=target) clearInterval(t); }, 40);
  ov.querySelector('.cel-done').addEventListener('click', () => {
    ov.classList.remove('show');
    setTimeout(() => ov.remove(), 300);
    renderHomeSheet();
  });
}

function fireConfetti(container) {
  const colors = ['#FF5A3C','#FFC24B','#7C5CE0','#1FBF9C','#F5F1E8'];
  for (let i=0;i<50;i++){
    const c=document.createElement('div');
    c.className='confetti';
    c.style.left=Math.random()*100+'%';
    c.style.background=colors[i%colors.length];
    c.style.borderRadius=i%2?'50%':'2px';
    c.style.animationDuration=(1.4+Math.random()*1.4)+'s';
    c.style.animationDelay=Math.random()*0.3+'s';
    container.appendChild(c);
    setTimeout(()=>c.remove(),3200);
  }
}

/* ---------- helpers ---------- */
function initSheetDrag() {
  let startY = 0, startOffset = 0, offset = 0, dragging = false, startScrollTop = 0;
  const getSheet = () => document.getElementById('sheet');
  const maxOffset = () => Math.max(0, getSheet().offsetHeight - 74);

  // a drag may start from the handle always, from the title/subtitle only
  // when the list is scrolled to the top, or anywhere on a collapsed sheet
  const canDrag = (e, sheet) => {
    if (e.target.closest('#sheetHandle')) return true;
    if (sheet.classList.contains('collapsed')) return true;
    if (sheet.scrollTop > 0) return false;
    return !!e.target.closest('.s-title, .s-sub');
  };

  // touchstart/move/end are delegated on #sheet itself (not a child), so they
  // survive setSheet() replacing the sheet's inner content on every render
  const sheet = getSheet();

  sheet.addEventListener('touchstart', e => {
    if (window.innerWidth >= 768) return;
    if (!canDrag(e, sheet)) return;
    dragging = true;
    startY = e.touches[0].clientY;
    startScrollTop = sheet.scrollTop;
    startOffset = sheet.classList.contains('collapsed') ? maxOffset() : 0;
    offset = startOffset;
    sheet.classList.add('dragging');
  }, { passive: true });

  sheet.addEventListener('touchmove', e => {
    if (!dragging) return;
    e.preventDefault();                  // block the browser's own scroll/zoom
    const dy = e.touches[0].clientY - startY;
    offset = Math.min(maxOffset(), Math.max(0, startOffset + dy));
    sheet.style.transform = `translateY(${offset}px)`;
  }, { passive: false });

  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('dragging');
    sheet.style.transform = '';          // hand control back to the class
    sheet.scrollTop = startScrollTop;    // in case any scroll slipped through
    toggleSheet(offset > maxOffset() / 2);
  };
  sheet.addEventListener('touchend', onEnd);
  sheet.addEventListener('touchcancel', onEnd);
}

function toggleSheet(force) {
  const sh = document.getElementById('sheet');
  const collapsed = force !== undefined ? force : !sh.classList.contains('collapsed');
  sh.classList.toggle('collapsed', collapsed);
  localStorage.setItem('psd-sheet-collapsed', collapsed ? '1' : '0');
}

function setSheet(html) {
  document.getElementById('sheet').classList.toggle('expanded', html.includes('data-venue-detail'));
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = `<div id="sheetHandle" aria-hidden="true"></div>` + html;
  sheet.classList.remove('anim');
  void sheet.offsetWidth;
  sheet.classList.add('anim');
  sheet.querySelectorAll('[data-open-venue]').forEach(el =>
    el.addEventListener('click', () => openVenue(el.dataset.openVenue)));
  sheet.querySelectorAll('[data-home]').forEach(el =>
    el.addEventListener('click', () => { stopTracking(); renderHomeSheet(); }));
}

function bindChips() {
  document.querySelectorAll('.chip').forEach(ch => {
    ch.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
      ch.classList.add('on');
      state.filter = ch.dataset.filter;
      renderMarkers();
      if (!state.selectedId) renderHomeSheet();
    });
  });
}

function bindLocate() {
  document.getElementById('locateBtn').addEventListener('click', () => {
    if (!navigator.geolocation) return;
    document.getElementById('locateLabel').textContent = '…';
    navigator.geolocation.getCurrentPosition(
      pos => {
        state.userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        document.getElementById('locateLabel').textContent = 'located';
        ensureUserMarker();
        state.map.flyTo({ center: [state.userPos.lng, state.userPos.lat], zoom: 15 });
        if (state.selectedId) {
          const v = venueById(state.selectedId);
          if (v) updateCheckinButton(v);
        }
      },
      () => { document.getElementById('locateLabel').textContent = 'near me'; }
    );
  });
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
const fmtDist = m => m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`;

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

const isNight = () => new Date().getHours() >= 17;

const dayGreeting = () => {
  const day = new Date().getDay();
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return `${names[day]} ${isNight() ? 'night' : ''}`.trim();
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

boot();
