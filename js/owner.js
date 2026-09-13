/* ============================================================================
   js/owner.js — the venue owner dashboard (submit form, edit form), the admin
   pending queue, and the venue photo uploader.
   ----------------------------------------------------------------------------
   Loaded on demand by loadChunk('owner') in js/app.js, never at boot. 53KB of
   the 323KB app.js was this, reachable only by an owner who taps "List your
   venue" or "Manage", or by an admin opening the pending queue — so every
   other visitor was parsing all of it before the first venue could paint.
   CLASSIC script, not a module, for the same reason as js/avatar.js: it keeps
   reading esc(), setSheet(), state, cloudinaryUrl(), loadingRing(), icoBack(),
   venueById(), openFlameSheet() and so on from app.js's global scope by name,
   so the move was a straight cut with no edits to the code itself.
   Entry points app.js calls (all via loadChunk('owner') first):
     openVenueSubmitForm()   [data-list-venue]
     openVenueEditor(v)      [data-manage-venue]
     openAdminPendingSheet() [data-admin-pending]
   Loading this file twice would throw on the duplicate `const`s, which is why
   loadChunk() caches its promise.
   ========================================================================== */

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
// TODO(lao) — WHOLE BLOCK. Every `lo` and `eg_lo` string below is my
// best-attempt translation and has NOT been checked by a native Lao speaker.
// Please review it in one pass before any of it ships: this is the one
// screen in the app where a wrong word makes a real owner type something
// wrong into the database. Two entries (`website`, and the "optional"
// marker text used across every optional field) were given verbatim and
// don't need re-checking; everything else does, including all fourteen
// `eg_lo` lines, which are new and are longer prose than anything that was
// here before — longer prose is exactly where a machine translation goes
// wrong in a way a non-speaker cannot see. If any of it is doubtful, delete
// the `eg_lo` and leave the English: an example in one language beats a
// wrong example in two.
//
// `eg` is the worked example: what a good answer to this field actually
// looks like. Added because a label alone was demonstrably not enough —
// Sunin's submission (see the note above) arrived with short and
// description null, "." typed into parking, and her Facebook link pasted
// into Website, and she said afterwards she didn't know what "short name"
// or "tagline" meant. A label tells you what a field is called; an example
// tells you what to type.
//
// None of these examples name a venue or quote real venue data. They
// describe the SHAPE of a good answer ("the part people actually say out
// loud"), never a specimen answer, so nothing here can be mistaken for a
// record, copied into one, or drift out of date with one.
const OWNER_FIELD_LABELS = {
  name:        { lo: 'ຊື່ຮ້ານ',        en: 'Name',
                 eg_lo: 'ຊື່ເຕັມ ຕາມທີ່ຂຽນຢູ່ປ້າຍຮ້ານ.',
                 eg: 'The whole name, exactly as it is written on your sign.' },
  short_name:  { lo: 'ຊື່ຫຍໍ້',         en: 'Short name — shown on cards instead of the full name',
                 eg_lo: 'ຄຳທີ່ຄົນເອີ້ນກັນຈິງ — ປົກກະຕິແມ່ນຄຳທຳອິດ. ຖ້າບໍ່ມີ ປະຫວ່າງໄວ້.',
                 eg: 'The part people actually say out loud — usually the first word or two. Leave it blank and we use the full name.' },
  name_lo:     { lo: 'ຊື່ພາສາລາວ',      en: 'Lao name',
                 eg_lo: 'ຊື່ຮ້ານຂຽນເປັນພາສາລາວ. ຖ້າບໍ່ໄດ້ໃຊ້ ປະຫວ່າງໄວ້.',
                 eg: 'Your name written in Lao. Leave it blank if you do not use one.' },
  type:        { lo: 'ປະເພດ',          en: 'Type' },
  area:        { lo: 'ເຂດ',            en: 'Area',
                 eg_lo: 'ເຂດທີ່ເຈົ້າຈະບອກຄົນຂັບຕຸກຕຸກ ບໍ່ແມ່ນທີ່ຢູ່ເຕັມ.',
                 eg: 'The neighbourhood you would give a tuk-tuk driver, not the full postal address.' },
  short:       { lo: 'ຄຳຂວັນສັ້ນ',      en: 'Short tagline — one line shown on your card',
                 eg_lo: 'ໜຶ່ງແຖວ ປະມານຫົກຄຳ ບອກວ່າຮ້ານນີ້ເປັນແນວໃດ. ຢູ່ໃຕ້ຊື່ຢູ່ກາດ.',
                 eg: 'One line, about six words, saying what kind of place this is. It sits under your name on the card.' },
  description: { lo: 'ຄຳອະທິບາຍ',       en: 'Description',
                 eg_lo: 'ສອງສາມປະໂຫຍກ ສຳລັບຄົນທີ່ບໍ່ເຄີຍມາ. ນັ່ງແລ້ວເປັນແນວໃດ ແລະ ຄວນສັ່ງຫຍັງ.',
                 eg: 'Two or three sentences for someone who has never been. What is it like to sit there, and what should they order?' },
  signature:   { lo: 'ເມນູເດັ່ນ',       en: 'Signature items — up to 3, shown as "Try this"',
                 eg_lo: 'ບໍ່ເກີນສາມຢ່າງທີ່ຮ້ານເຈົ້າເດັ່ນ — ຊື່ ແລະ ລາຄາ ຖ້າຢາກສະແດງ.',
                 eg: 'Up to three things you are known for — the name, and the price in kip if you want to show it.' },
  photos:      { lo: 'ຮູບພາບ',         en: 'Photos',
                 eg_lo: 'ຮູບທຳອິດແມ່ນຮູບທີ່ຄົນເຫັນຢູ່ແຜນທີ່ ແລະ ຢູ່ກາດ. ຮູບນອນດີກວ່າ.',
                 eg: 'The first one is the photo people see on the map and on cards. A landscape photo works best.' },
  hours:       { lo: 'ໂມງເປີດ-ປິດ',     en: 'Hours',
                 eg_lo: 'ຕິກມື້ທີ່ເປີດ ແລ້ວຕັ້ງເວລາ. ມື້ທີ່ປິດ ບໍ່ຕ້ອງຕິກ.',
                 eg: 'Tick each day you open and set the times. Leave a day unticked if you are closed that day.' },
  phone:       { lo: 'ເບີໂທ',          en: 'Phone',
                 eg_lo: 'ເບີທີ່ລູກຄ້າໂທຫາ. ຂຽນແບບທີ່ເຈົ້າຂຽນປົກກະຕິ.',
                 eg: 'The number customers should call. Write it the way you normally would — we reformat it for the call button.' },
  parking:     { lo: 'ບ່ອນຈອດລົດ',      en: 'Parking note',
                 eg_lo: 'ໜຶ່ງແຖວສັ້ນໆ ບອກບ່ອນຈອດລົດຈັກ ຫຼື ລົດໃຫຍ່. ຖ້າບໍ່ແນ່ໃຈ ປະຫວ່າງໄວ້.',
                 eg: 'One short line about where to leave a motorbike or a car. If you are not sure, leave it blank — a wrong note sends people circling the block.' },
  facebook:    { lo: 'ລິ້ງເຟສບຸກ',      en: 'Facebook link',
                 eg_lo: 'ລິ້ງໜ້າເຟສບຸກຂອງຮ້ານ.',
                 eg: 'The link to your Facebook page.' },
  website:     { lo: 'ເວັບໄຊ (ບໍ່ແມ່ນ Facebook)', en: 'Website — not Facebook',
                 eg_lo: 'ສະເພາະເວັບໄຊທີ່ບໍ່ແມ່ນເຟສບຸກ. ຖ້າມີແຕ່ເຟສບຸກ ປະຫວ່າງໄວ້ — ໃສ່ຊ່ອງເທິງ.',
                 eg: 'Only if you have a website that is not Facebook. If Facebook is your only page, leave this blank — it goes in the field above.' },
  maps_url:    { lo: 'ລິ້ງ Google Maps', en: 'Google Maps link',
                 eg_lo: 'ຊອກຮ້ານຢູ່ Google Maps, ກົດ Share, ແລ້ວວາງລິ້ງໃສ່ນີ້. ນີ້ຄືວິທີທີ່ເຮົາປັກໝຸດ.',
                 eg: 'Find your venue on Google Maps, tap Share, and paste the link here. This is how we place your pin.' },
};

// mirrors the server's actual requirement — name, type, area, maps_url
// (see REQUIRED_SIMPLE_FIELDS in functions/api/_venue-validation.js and the
// maps_url check in functions/api/venues.js's handlePost). Every other
// field renders the optional marker instead — the concrete fix for the
// "typed '.' into parking to get past it" problem, since nothing on the
// old form told her she could just leave it blank.
const REQUIRED_FIELD_KEYS = new Set(['name', 'type', 'area', 'maps_url']);

/* Sunin typed "." into parking rather than leave it empty, on a field that
   was already marked optional. A per-field marker apparently reads as
   paperwork; a sentence at the top of the form, before any field, reads as
   permission. It is also this project's actual data rule stated to the
   person it applies to — CLAUDE.md would rather have a null than a guess,
   and until now nothing on the form said so.
   Shared by both owner forms so the two can't end up saying it differently,
   or one of them not saying it at all.
   TODO(lao): the Lao line is my own unchecked translation — see the block
   note on OWNER_FIELD_LABELS below. */
function edBlankHintHtml() {
  return `<div class="ed-blank-hint">
      <span class="lao">ຖ້າບໍ່ແນ່ໃຈ ປະຫວ່າງໄວ້ ດີກວ່າເດົາ.</span>
      <span class="ed-blank-hint-en">Not sure about something? Leave it blank. We would rather have an empty field than a guess, and you can add it later.</span>
    </div>`;
}

function edLabelHtml(key, forId) {
  const l = OWNER_FIELD_LABELS[key];
  const marker = REQUIRED_FIELD_KEYS.has(key)
    ? '<span class="ed-label-req">ຈຳເປັນ / required</span>'
    : '<span class="ed-label-opt">ບໍ່ຈຳເປັນ / optional</span>';
  // the worked example, Lao first then English, same order as the label
  // above it. It goes INSIDE the <label>, so tapping the example focuses
  // the field it describes — an instruction you have to read and then
  // separately go and find the box for is half an instruction.
  // `type` has no example (it is a <select>; its options are the
  // explanation), so the whole block is skipped rather than left empty.
  const eg = l.eg
    ? `<span class="ed-label-eg">
         ${l.eg_lo ? `<span class="lao">${esc(l.eg_lo)}</span>` : ''}
         <span class="ed-label-eg-en">${esc(l.eg)}</span>
       </span>`
    : '';
  return `<label class="ed-label"${forId ? ` for="${forId}"` : ''}>
      <span class="ed-label-lo lao">${l.lo}</span>
      <span class="ed-label-en">${l.en}</span>
      ${marker}
      ${eg}
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
    ${edBlankHintHtml()}

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
    ${edBlankHintHtml()}

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
      photoField.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
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
