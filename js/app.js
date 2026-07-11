/* ============================================================
   Muan — phase 1
   Map + curated venues/events. No accounts, no check-ins yet.
   Check-ins, streaks and badges arrive in phase 2 (Workers + D1).
   ============================================================ */

const COLORS = { bar: '#FF5A3C', cafe: '#1FBF9C', event: '#7C5CE0', venue: '#7C5CE0' };
const VIENTIANE = { lng: 102.6030, lat: 17.9630 };

const state = {
  venues: [],
  events: [],
  filter: 'all',
  markers: [],
  userPos: null,
  map: null,
  selectedId: null,
  theme: null,
  tracking: null,
  trackWatchId: null,
};

/* ---------- boot ---------- */
async function boot() {
  const [vRes, eRes] = await Promise.all([
    fetch('data/venues.json'),
    fetch('data/events.json'),
  ]);
  state.venues = (await vRes.json()).venues;
  state.events = (await eRes.json()).events.filter(ev => !isPast(ev.date));

  applyTheme();
  bindTheme();
  initMap();
  renderHomeSheet();
  bindChips();
  bindLocate();
}

/* ---------- theme ---------- */
const TILES = {
  dark:  ['a','b','c'].map(s => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png`),
  light: ['a','b','c'].map(s => `https://${s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png`),
};

function resolvedTheme() {
  const pref = localStorage.getItem('muan-theme') || 'auto';
  if (pref !== 'auto') return pref;
  const h = new Date().getHours();
  return (h >= 17 || h < 6) ? 'dark' : 'light';
}

function mapStyle(theme) {
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
    attributionControl: { compact: true },
    style: mapStyle(state.theme),
  });
  state.map.on('load', renderMarkers);
  state.map.on('zoom', () => {
    document.getElementById('map').classList.toggle('labels-hidden', state.map.getZoom() < 13);
  });
  state.map.on('click', (e) => {
    if (e.originalEvent.target.closest('.marker')) return;
    if (state.selectedId) { stopTracking(); renderHomeSheet(); }
  });
}

function pinSVG(color, scale) {
  const s = 30 * scale;
  return `<svg width="${s}" height="${s * 1.2}" viewBox="0 0 72 88">
    <path d="M36 4 C18 4 6 17 6 33 C6 52 26 70 36 84 C46 70 66 52 66 33 C66 17 54 4 36 4 Z" fill="${color}"/>
    <circle cx="36" cy="32" r="13" fill="#131019"/>
  </svg>`;
}

function renderMarkers() {
  state.markers.forEach(m => m.remove());
  state.markers = [];

  const visible = state.venues.filter(v =>
    state.filter === 'all' ||
    v.type === state.filter ||
    (state.filter === 'event' && venueEvents(v.id).length > 0)
  );

  for (const v of visible) {
    const hot = isNo1(v);
    const el = document.createElement('div');
    el.className = 'marker' + (hot ? ' is-hot' : '');
    if (v.id === state.selectedId) el.classList.add('is-selected');
    el.innerHTML = `
      ${pinSVG(hot ? '#FF5A3C' : COLORS[v.type] || '#8A8494', hot ? 1.25 : 1)}
      <div class="m-label">${esc(v.short_name || v.name)}</div>
      ${hot ? `<div class="m-sub" style="color:#FF5A3C">tonight</div>` : ''}`;
    el.addEventListener('click', () => openVenue(v.id));

    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([v.lng, v.lat])
      .addTo(state.map);
    state.markers.push(marker);
  }
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
function renderHomeSheet() {
  state.selectedId = null; if (state.map) renderMarkers();
  const today = todayISO();
  const tonight = state.events.filter(ev => ev.date === today);
  const upcoming = state.events.filter(ev => ev.date > today).slice(0, 6);

  let html = `
    <div class="s-title">${dayGreeting()}, Vientiane</div>
    <div class="s-sub lao">ຄືນນີ້ໄປໃສດີ? · tap a pin to explore</div>`;

  if (tonight.length === 0 && upcoming.length === 0) {
    html += `<div class="empty">No events listed yet this week.<br>New list every Thursday.</div>`;
  }

  for (const ev of tonight) {
    const v = venueById(ev.venue_id);
    if (!v) continue;
    const st = openStatus(v);
    html += `
      <div class="card" data-open-venue="${v.id}">
        <div class="row">
          <span class="tag flame">TONIGHT · ${esc(v.area || '')}</span>
          <span class="tag ${st.open ? 'open' : 'closed'}">${st.open ? '● OPEN' : st.label.toUpperCase()}</span>
        </div>
        <div class="t-name">${esc(ev.title)} — ${esc(v.name)}</div>
        <div class="t-sub">${fmtTime(toMins(ev.start_time))} · ${fmtPrice(ev.price)}${ev.verified ? '' : ' · unconfirmed'}</div>
      </div>`;
  }

  if (upcoming.length) {
    html += `<div class="hcards">` + upcoming.map(ev => {
      const v = venueById(ev.venue_id);
      return `
        <div class="hcard" data-open-venue="${ev.venue_id}">
          <div class="tag violet">${fmtDate(ev.date)}</div>
          <div style="font-size:12.5px;font-weight:700;margin-top:2px;">${esc(ev.title)}</div>
          <div style="font-size:11px;color:var(--mute);">${esc(v ? v.name : '')} · ${fmtPrice(ev.price)}</div>
        </div>`;
    }).join('') + `</div>`;
  }

  setSheet(html);
}

/* ---------- sheet: venue detail ---------- */
function openVenue(id) {
  const v = venueById(id);
  if (!v) return;
  state.selectedId = id; renderMarkers();
  const st = openStatus(v);
  const evs = venueEvents(id);

  const photos = (v.photos && v.photos.length)
    ? v.photos.map(p => `<img src="${esc(p)}" alt="${esc(v.name)}" loading="lazy">`).join('')
    : `<div class="photo-ph">📷<span>photos coming soon</span></div>
       <div class="photo-ph">🖼️<span>ຮູບກຳລັງມາ</span></div>`;

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
  const week = order.map(d => {
    const h = parseHours(v.hours[d]);
    const label = h ? `${fmtTime(h.open)} – ${fmtTime(h.close % 1440)}` : 'closed';
    return `<div class="${d === todayKey ? 'today' : ''}"><span>${d}</span><span>${label}</span></div>`;
  }).join('');

  let html = `
    <span data-venue-detail hidden></span>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div>
        <div class="s-title">${esc(v.name)} <span class="lao" style="font-size:13px;color:var(--mute);">${esc(v.name_lo || '')}</span></div>
        <div class="s-sub">${esc(v.short || '')}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
        ${isNo1(v) ? '<span class="tag flame" style="background:var(--ink3);padding:5px 10px;border-radius:12px;">TONIGHT</span>' : ''}
        <button class="sheet-x" data-home aria-label="Close">✕</button>
      </div>
    </div>

    <div class="photo-strip">${photos}</div>

    <div class="info-row">
      <div class="info-ic">📍</div>
      <div class="info-main">${esc(v.area || '')}<div class="sub">${travel}</div></div>
    </div>
    <div class="info-row">
      <div class="info-ic">🕐</div>
      <div class="info-main">
        <span style="color:var(--${st.open ? 'teal' : 'dim'});font-weight:700;">${st.label}</span>
        · <span class="hours-toggle" id="hoursToggle">all hours</span>
        <div class="hours-week" id="hoursWeek">${week}</div>
      </div>
    </div>
    ${v.description ? `
    <div class="info-row">
      <div class="info-ic">ℹ️</div>
      <div class="info-main">${esc(v.description)}</div>
    </div>` : ''}`;

  for (const ev of evs) {
    html += `
      <div class="card" style="cursor:default;">
        <span class="tag violet">${ev.date === todayISO() ? 'TONIGHT' : fmtDate(ev.date)}</span>
        <div style="font-size:13px;font-weight:700;margin-top:3px;">${esc(ev.title)}</div>
        <div class="t-sub">${fmtTime(toMins(ev.start_time))} · ${fmtPrice(ev.price)}${ev.verified ? '' : ' · unconfirmed'}</div>
      </div>`;
  }

  html += `
    <div class="section-h">Comments</div>
    <div class="comment-empty">
      No comments yet.<br>
      Comments open when check-ins launch — be the first regular. 🔥
    </div>

    <div class="btn-row">
      <button class="btn btn-back" data-home>←</button>
      <a class="btn btn-go" href="https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}" target="_blank" rel="noopener">📍 Take me there</a>
      ${v.links.facebook ? `<a class="btn btn-fb" href="${esc(v.links.facebook)}" target="_blank" rel="noopener">Page</a>` : ''}
      <button class="btn btn-fb" id="trackBtn" style="flex:0 0 auto;padding:0 16px;">🔥 Track</button>
    </div>
    ${v.verified ? '' : '<div class="hint">details unconfirmed — hours may differ</div>'}`;

  setSheet(html);
  const ht = document.getElementById('hoursToggle');
  if (ht) ht.addEventListener('click', () =>
    document.getElementById('hoursWeek').classList.toggle('show'));
  const tb = document.getElementById('trackBtn');
  if (tb) tb.addEventListener('click', () => startTracking(v));
  state.map.flyTo({ center: [v.lng, v.lat], zoom: 15.5, speed: 1.4 });
}

/* ---------- helpers ---------- */
function setSheet(html) {
  document.getElementById('sheet').classList.toggle('expanded', html.includes('data-venue-detail'));
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = html;
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
        new maplibregl.Marker({ color: '#4B9BFF' })
          .setLngLat([state.userPos.lng, state.userPos.lat])
          .addTo(state.map);
        state.map.flyTo({ center: [state.userPos.lng, state.userPos.lat], zoom: 15 });
      },
      () => { document.getElementById('locateLabel').textContent = 'near me'; }
    );
  });
}

/* ---------- tracking mode ---------- */
function startTracking(v) {
  if (!navigator.geolocation) return;
  stopTracking();
  state.tracking = v.id;
  state.trackWatchId = navigator.geolocation.watchPosition(
    pos => updateTrack(v, { lat: pos.coords.latitude, lng: pos.coords.longitude }),
    () => stopTracking(),
    { enableHighAccuracy: true }
  );
  document.getElementById('trackChip').classList.add('on');
  document.getElementById('trackChip').textContent = 'locating…';
  document.getElementById('trackChip').onclick = stopTracking;
}

function updateTrack(v, pos) {
  state.userPos = pos;
  const m = haversine(pos, v);
  document.getElementById('trackChip').textContent =
    `🔥 ${fmtDist(m)} to ${v.short_name || v.name} — tap to stop`;
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
  document.getElementById('trackChip').classList.remove('on');
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

const dayGreeting = () => {
  const day = new Date().getDay();
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return `${names[day]} ${new Date().getHours() >= 17 ? 'night' : ''}`.trim();
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

boot();
