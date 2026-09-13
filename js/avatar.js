/* ============================================================================
   js/avatar.js — the avatar picker and the profile-photo upload.
   ----------------------------------------------------------------------------
   Loaded on demand by loadChunk('avatar') in js/app.js, never at boot. This
   is a CLASSIC script, not a module, on purpose: classic scripts share one
   global lexical scope, so everything in here still reads esc(), setSheet(),
   state, openFlameSheet(), applyAvatarUrl(), AVATARS and the rest straight
   out of app.js by name, exactly as it did when it lived there. That is what
   made this a cut-and-paste rather than a rewrite — there is no import list
   to keep in sync and not one line of the code below changed.
   Nothing in here may be referenced before the chunk has loaded: app.js
   reaches it only through the three call sites in renderFlameSheetBody(),
   all of them behind loadChunk('avatar'). Loading this file twice would
   throw on the duplicate `const` below, which is why loadChunk() caches its
   promise and only forgets it when the script never executed at all.
   ========================================================================== */

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
// other buttons — #pfpBtn/#pfpLink/#pfpFile/#pfpErr are only present in
// that markup. Two triggers now that the avatar is a single slot: the
// avatar itself (#pfpBtn) and the "Add a photo"/"Change photo" link under
// it (#pfpLink), both opening the same file input.
function wirePfpUpload() {
  const btn = document.getElementById('pfpBtn');
  const link = document.getElementById('pfpLink');
  const file = document.getElementById('pfpFile');
  const err = document.getElementById('pfpErr');
  if (!btn || !file) return;
  const pick = () => { err.textContent = ''; file.value = ''; file.click(); };
  btn.addEventListener('click', pick);
  link?.addEventListener('click', pick);
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { err.textContent = 'images only'; return; }
    if (f.size > MAX_AVATAR_BYTES) { err.textContent = 'must be 4MB or smaller'; return; }
    btn.disabled = true;
    if (link) link.disabled = true;
    err.textContent = 'Uploading…';
    try {
      const url = await uploadAvatarFile(f);
      applyAvatarUrl(url);
      openFlameSheet();  // re-renders the You screen with the new photo
    } catch (e) {
      err.textContent = e.message || 'upload failed';
      btn.disabled = false;
      if (link) link.disabled = false;
    }
  });
}

// clears the photo and falls back to the chibi — /api/me/avatar has always
// accepted { public_id: null } for this, but with the old two-avatar card
// there was nothing to fall back TO (the chibi was already on screen under
// the photo), so nothing ever called it. Now that one slot holds both,
// removing the photo is the only way back to the chibi.
async function removeAvatarPhoto() {
  const err = document.getElementById('pfpErr');
  if (err) err.textContent = 'Removing…';
  try {
    const r = await fetch('/api/me/avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_id: null }),
    });
    const data = await r.json().catch(() => null);
    if (!data || !data.ok) throw new Error(data?.error || 'could not remove photo');
    applyAvatarUrl(null);
    openFlameSheet();
  } catch (e) {
    if (err) err.textContent = e.message || 'could not remove photo';
  }
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
      // the button's whole content is an <svg>, so without this a screen
      // reader announced six identical "button"s and no way to tell which
      // one was picked — the only unlabelled interactive element left in
      // the app once the rest were audited
      `<button class="av-opt ${String(i)===cur?'sel':''}" data-av="${i}" aria-label="Avatar ${i + 1} of ${AVATARS.length}"${String(i)===cur?' aria-current="true"':''}>${avatarSVG(i, 44)}</button>`
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
