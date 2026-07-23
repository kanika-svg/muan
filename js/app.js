/* ============================================================
   Muan — phase 1
   Map + curated venues/events. No accounts, no check-ins yet.
   Check-ins, streaks and badges arrive in phase 2 (Workers + D1).
   ============================================================ */

const COLORS = { bar: '#FF5A3C', cafe: '#1FBF9C', event: '#7C5CE0', venue: '#7C5CE0' };
const VIENTIANE = { lng: 102.6030, lat: 17.9630 };
const GOOGLE_CLIENT_ID = '768624583305-553qrbhib2mqbbi10ifsr18b8uqu4uvk.apps.googleusercontent.com';

const state = {
  venues: [],
  events: [],
  picks: null,
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

  const st = document.getElementById('sheetToggle');
  st.addEventListener('click', () => {
    toggleSheet();
    st.textContent = document.getElementById('sheet').classList.contains('collapsed') ? '›' : '‹';
  });
  // restore last state on load, but only for the home sheet
  if (localStorage.getItem('psd-sheet-collapsed') === '1') { toggleSheet(true); st.textContent = '›'; }

  const params = new URLSearchParams(location.search);
  const vid = params.get('v');
  if (vid && venueById(vid)) {
    openVenue(vid);
    if (state.map) state.map.flyTo({ center: [venueById(vid).lng, venueById(vid).lat], zoom: 15.5 });
  }
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

const AVATARS = ['#E8B98A|#1C1726','#C98E6B|#131019','#E8B98A|#7C5CE0','#C98E6B|#1FBF9C','#8A5A3B|#FF5A3C','#E8B98A|#FFC24B'];
function avatarSVG(i, size) {
  const [skin, shirt] = AVATARS[i].split('|');
  return `<svg viewBox="0 0 44 44" width="${size}" height="${size}">
    <circle cx="22" cy="22" r="21" fill="var(--ink3)"/>
    <path d="M8 44 C8 34 14 30 22 30 C30 30 36 34 36 44 Z" fill="${shirt}"/>
    <circle cx="22" cy="19" r="9" fill="${skin}"/>
    <path d="M13 18 C13 11 17 8 22 8 C27 8 31 11 31 18 C31 14 27 12.5 22 12.5 C17 12.5 13 14 13 18 Z" fill="#131019"/>
    <ellipse cx="18.8" cy="18.5" rx="1.3" ry="1.8" fill="#131019"/>
    <ellipse cx="25.2" cy="18.5" rx="1.3" ry="1.8" fill="#131019"/>
    <path d="M19.5 23 Q22 24.8 24.5 23" fill="none" stroke="#131019" stroke-width="1.2" stroke-linecap="round"/>
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

async function openFlameSheet() {
  setSheet('<div class="s-sub" style="text-align:center;padding:30px 0;">Loading your flame…</div>');
  let me = null;
  try { me = await (await fetch('/api/me')).json(); } catch(e) {}
  if (!me || !me.ok) { setSheet('<div class="s-sub" style="text-align:center;padding:30px 0;">Could not load — try again.</div>'); return; }

  if (me.signed_out) {
    setSheet(`
      <div class="fl-wrap">
        <div class="fl-flame" style="opacity:.4;">
          <svg viewBox="0 0 120 140" width="110" height="128">
            <defs><linearGradient id="flg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#FFC24B"/><stop offset=".55" stop-color="#FF5A3C"/><stop offset="1" stop-color="#C6432A"/>
            </linearGradient></defs>
            <path d="M60 6 C48 30 24 44 24 82 C24 112 40 132 60 132 C80 132 96 112 96 82 C96 60 84 48 78 34 C74 46 68 50 64 48 C68 34 66 20 60 6 Z" fill="url(#flg)"/>
          </svg>
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

  setSheet(`
    <div class="fl-wrap">
      ${me.handle ? `<div class="fl-handle">@${esc(me.handle)}</div>` : ''}
      <div class="fl-flame">
        <svg viewBox="0 0 120 140" width="110" height="128">
          <defs><linearGradient id="flg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#FFC24B"/><stop offset=".55" stop-color="#FF5A3C"/><stop offset="1" stop-color="#C6432A"/>
          </linearGradient></defs>
          <path d="M60 6 C48 30 24 44 24 82 C24 112 40 132 60 132 C80 132 96 112 96 82 C96 60 84 48 78 34 C74 46 68 50 64 48 C68 34 66 20 60 6 Z" fill="url(#flg)"/>
        </svg>
        <div class="fl-streak">${me.streak_months}</div>
      </div>
      <div class="fl-stage">${stageLabels[me.phai_stage]} · <span class="lao">${stageLo[me.phai_stage]}</span></div>
      <div class="fl-sub">${me.streak_months} month streak — every month out keeps it lit</div>

      <div class="fl-embers"><b>${me.embers_total}</b> embers</div>

      <div class="fl-month">${monthName}</div>
      ${cal}

      <div class="fl-stats">
        <div class="fl-stat"><b>${me.venues_explored}</b><span>places explored</span></div>
        <div class="fl-stat"><b>${me.total_checkins}</b><span>check-ins</span></div>
      </div>

      ${me.badges?.length ? `
      <div class="fl-badges">
        ${me.badges.map(b => `<div class="fl-badge" title="${esc(b.description||'')}">
           <span class="fl-badge-ico">${b.icon}</span>
           <span class="fl-badge-name">${esc(b.name)}</span>
         </div>`).join('')}
      </div>` : ''}

      <button class="btn fl-avatar" data-open-avatar>
        ${i !== null ? avatarSVG(+i, 22) : '😊'} <span>Change avatar</span>
      </button>
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
    minZoom: 12.4,
    maxBounds: [[102.49, 17.88], [102.75, 18.05]],
    attributionControl: { compact: true },
    style: mapStyle(state.theme),
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
    document.getElementById('map').classList.toggle('zoomed-close', state.map.getZoom() >= 15.5);
  });
  state.map.on('click', (e) => {
    if (e.originalEvent.target.closest('.marker')) return;
    if (state.selectedId) { stopTracking(); renderHomeSheet(); }
    if (window.innerWidth < 768) toggleSheet(true);
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
    el.className = 'marker' + (hot ? ' is-hot' : '');
    el.style.animationDelay = `${state.markers.length * 45}ms`;
    if (v.id === state.selectedId) el.classList.add('is-selected');
    el.innerHTML = `
      ${pinSVG(hot ? '#FF5A3C' : COLORS[v.type] || '#8A8494', hot ? 1.25 : 1)}
      <div class="m-label">${esc(v.short_name || v.name)}</div>
      ${hot ? `<div class="m-sub" style="color:#FF5A3C">tonight</div>` : ''}`;
    el.addEventListener('click', () => openVenue(v.id));

    /* visual de-overlap only — real coords stay in data and directions */
    const seen = state.markers.filter(m => {
      const p = m.marker.getLngLat();
      return Math.abs(p.lat - v.lat) < 0.0004 && Math.abs(p.lng - v.lng) < 0.0004;
    }).length;
    const offLng = v.lng + seen * 0.00055;

    const crowded = state.markers.some(m => {
      const p = m.marker.getLngLat();
      return Math.abs(p.lat - v.lat) < 0.0012 && Math.abs(p.lng - v.lng) < 0.0022;
    });
    if (crowded) el.classList.add('label-crowded');

    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([offLng, v.lat])
      .addTo(state.map);
    state.markers.push({ id: v.id, el, marker });
  }
  updateSelection();
}

function updateSelection() {
  for (const m of state.markers) {
    m.el.classList.toggle('is-selected', m.id === state.selectedId);
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

  const hasPhoto = v => Array.isArray(v.photos) && v.photos.length > 0;

  const late = state.venues.filter(v => opensLate(v) && matchType(v) && hasPhoto(v));
  const fresh = state.venues.filter(v => matchType(v) && hasPhoto(v)).slice(-3).reverse();
  const pickVenues = (state.picks?.venue_ids || []).map(venueById).filter(Boolean).filter(matchType).filter(hasPhoto);

  const showEvents = (f === 'all' || f === 'event');
  const showVenueSections = (f !== 'event');

  const secH = (color, label, note) =>
    `<div class="sec-h"><span class="dot" style="background:var(--${color});"></span>${label}${note ? `<span class="sec-note">${note}</span>` : ''}</div>`;

  let html = `
    <div class="s-title">${dayGreeting()}, Vientiane</div>
    <div class="s-sub lao">ຄືນນີ້ໄປໃສດີ?</div>`;
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

  if (showEvents && upcoming.length) {
    rendered = true;
    html += secH('violet', 'Upcoming · ກຳລັງມາ') + `<div class="hcards">` +
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

  if (showVenueSections && late.length) {
    rendered = true;
    html += secH('teal', 'Open late · ເປີດເດິກ') + `<div class="hcards">` +
      late.map(v => sectionCard(v, openStatus(v).label)).join('') + `</div>`;
  }

  if (showVenueSections && fresh.length) {
    rendered = true;
    html += secH('gold', 'New on Paisaidee · ມາໃໝ່') + `<div class="hcards">` +
      fresh.map(v => sectionCard(v, `${esc(v.type)} · ${esc(v.area || '')}`)).join('') + `</div>`;
  }

  if (!rendered) {
    html += `<div class="sec-empty">Nothing here right now — try another filter.</div>`;
  }

  setSheet(html);
  history.replaceState(null, '', location.pathname);
  const sh = document.getElementById('sheet');
  sh.classList.remove('sheet-anim'); void sh.offsetWidth; sh.classList.add('sheet-anim');
}

/* ---------- sheet: venue detail ---------- */
function openVenue(id) {
  const v = venueById(id);
  if (!v) return;
  toggleSheet(false);
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
      <a class="act" href="${esc(v.links?.maps || '#')}" target="_blank" rel="noopener">
        <span class="act-ico">➤</span><span class="act-lbl">Directions</span>
      </a>
      <button class="act" id="shareBtn">
        <span class="act-ico">↗</span><span class="act-lbl">Share</span>
      </button>
    </div>

    <div class="v-fact">
      <div class="info-ic">📍</div>
      <div class="info-main">${esc(v.area || '')}<div class="sub">${travel}</div></div>
    </div>
    <div class="v-fact">
      <div class="info-ic">🕐</div>
      <div class="info-main">
        <span style="color:var(--${st.open ? 'teal' : 'dim'});font-weight:700;">${st.label}</span>
        · <span class="hours-toggle" id="hoursToggle">all hours</span>
        <div class="hours-week" id="hoursWeek">${week}</div>
      </div>
    </div>
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
    ${v.verified ? '' : '<div class="hint">details unconfirmed — hours may differ</div>'}`;

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
    if (!state.userPos) {
      document.getElementById('checkinLabel').textContent = 'Enable location to check in';
    } else {
      const d = haversine(state.userPos, v);
      if (d <= 150) {
        cbtn.disabled = false;
        cbtn.classList.add('ready');
        document.getElementById('checkinLabel').textContent = "You're here — check in";
      } else {
        document.getElementById('checkinLabel').textContent = `${fmtDist(d)} away — get closer`;
      }
    }
    cbtn.addEventListener('click', () => doCheckin(v));
  }

  state.map.flyTo({ center: [v.lng, v.lat], zoom: 15.5, speed: 1.4 });
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
        ${data.first_visit ? '<div class="cel-row cel-new"><span>First visit here</span><b>+bonus</b></div>' : `<div class="cel-row"><span>Visits here</span><b>${data.venue_checkins}</b></div>`}
        ${data.new_badges?.length ? data.new_badges.map(b =>
          `<div class="cel-row cel-badge"><span>${b.icon} ${esc(b.name)}</span><b>unlocked</b></div>`
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

const dayGreeting = () => {
  const day = new Date().getDay();
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return `${names[day]} ${new Date().getHours() >= 17 ? 'night' : ''}`.trim();
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

boot();
