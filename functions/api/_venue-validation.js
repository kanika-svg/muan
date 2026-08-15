// Shared field validation for venue writes — used by both
// functions/api/venues/[id].js (owner edits, PATCH) and functions/api/venues.js
// (owner submissions, POST). Pulled out here once a second write path needed
// the exact same rules, same pattern as _auth.js/_heat.js being shared
// helpers rather than duplicated per-endpoint.
export const SIMPLE_FIELDS = ['name', 'short_name', 'name_lo', 'type', 'area', 'short', 'description', 'hours_note'];
// the only two SIMPLE_FIELDS an owner can't leave blank — 'type' has its
// own required check (must be a valid VENUE_TYPES value) and maps_url is
// required separately in functions/api/venues.js since it isn't a plain
// column, it lives inside links. Together these four (name, type, area,
// maps_url) are every required field on the owner forms; everything else
// is optional — see the "ບໍ່ຈຳເປັນ / optional" marker in js/app.js
// edLabelHtml(), which mirrors this exact set.
export const REQUIRED_SIMPLE_FIELDS = new Set(['name', 'area']);
export const VENUE_TYPES = ['bar', 'cafe', 'venue'];
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const MAX_LEN = { name: 100, short_name: 40, name_lo: 60, area: 80, short: 120, description: 500, hours_note: 80 };
export const MAX_PARKING_NOTE = 60;
export const MAX_SIG_ITEMS = 3;
export const MAX_SIG_NAME = 60;
export const MAX_SIG_NOTE = 80;
export const MAX_PHOTOS = 8;

export function isUrlish(s) {
  return s === '' || /^https?:\/\/\S+$/i.test(s);
}

// "HH:MM-HH:MM", close hour may run up to 27 to express past-midnight
// closing (see data/venues.json's _schema_notes) — close must be strictly
// after open once both are read as plain minutes-since-midnight
function validHourRange(str) {
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(str);
  if (!m) return false;
  const [, oh, om, ch, cm] = m.map(Number);
  if (oh > 23 || om > 59 || ch > 27 || cm > 59) return false;
  const openMins = oh * 60 + om;
  const closeMins = ch * 60 + cm;
  return closeMins > openMins;
}

export function validateHours(hours, errors) {
  if (hours === null) return null;
  if (typeof hours !== 'object' || Array.isArray(hours)) {
    errors.hours = 'invalid hours';
    return undefined;
  }
  const out = {};
  for (const day of DAYS) {
    const v = hours[day];
    if (v === null || v === undefined) { out[day] = null; continue; }
    if (typeof v !== 'string' || !validHourRange(v)) {
      errors.hours = `${day}: expected "HH:MM-HH:MM" or null`;
      return undefined;
    }
    out[day] = v;
  }
  return out;
}

export function validateContact(contact, errors) {
  if (contact === null) return null;
  if (typeof contact !== 'object' || Array.isArray(contact)) {
    errors.contact = 'invalid contact';
    return undefined;
  }
  const phone = typeof contact.phone === 'string' ? contact.phone.trim() : '';
  const phone_display = typeof contact.phone_display === 'string' ? contact.phone_display.trim() : '';
  if (!phone) return null; // clearing the phone clears the whole contact block
  if (!/^\+856\d{6,10}$/.test(phone)) {
    errors.contact = 'phone should derive to +856 followed by 6-10 digits';
    return undefined;
  }
  return { phone, phone_display: phone_display || phone };
}

export function validateParking(parking, errors) {
  if (parking === null) return null;
  if (typeof parking !== 'object' || Array.isArray(parking)) {
    errors.parking = 'invalid parking';
    return undefined;
  }
  const note = typeof parking.note === 'string' ? parking.note.trim() : '';
  const source = typeof parking.source === 'string' ? parking.source.trim() : '';
  if (!note) return null;
  if (note.length > MAX_PARKING_NOTE) {
    errors.parking = `note must be ${MAX_PARKING_NOTE} characters or fewer`;
    return undefined;
  }
  return { note, source: source || 'venue told us' };
}

// up to 3 "try this" items (CLAUDE.md: name required, price/note optional,
// not a full menu). A row with a blank name is dropped rather than
// rejected — matches the edit form's "all clearable" rows, where clearing
// a row's name is how an owner deletes that item.
export function validateSignature(signature, errors) {
  if (signature === null) return null;
  if (!Array.isArray(signature)) {
    errors.signature = 'invalid signature items';
    return undefined;
  }
  const out = [];
  for (const raw of signature) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      errors.signature = 'invalid signature item';
      return undefined;
    }
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) continue;
    if (name.length > MAX_SIG_NAME) {
      errors.signature = `item name must be ${MAX_SIG_NAME} characters or fewer`;
      return undefined;
    }
    const item = { name };
    if (raw.price !== undefined && raw.price !== null && raw.price !== '') {
      const price = Number(raw.price);
      if (!Number.isInteger(price) || price < 0) {
        errors.signature = 'price must be a whole number of kip';
        return undefined;
      }
      item.price = price;
    }
    if (typeof raw.note === 'string' && raw.note.trim()) {
      const note = raw.note.trim();
      if (note.length > MAX_SIG_NOTE) {
        errors.signature = `note must be ${MAX_SIG_NOTE} characters or fewer`;
        return undefined;
      }
      item.note = note;
    }
    out.push(item);
  }
  if (out.length > MAX_SIG_ITEMS) {
    errors.signature = `up to ${MAX_SIG_ITEMS} items only`;
    return undefined;
  }
  return out.length ? out : null;
}

// validates the SIMPLE_FIELDS present in body, pushing "field = ?" / bind
// pairs for each valid one directly onto the caller's sets/binds arrays —
// shared between PATCH (any subset present) and POST create (name/type
// required, checked separately by the caller before calling this)
export function validateSimpleFields(body, errors, sets, binds) {
  for (const field of SIMPLE_FIELDS) {
    if (!(field in body)) continue;
    const v = body[field];
    if (field === 'type') {
      if (!VENUE_TYPES.includes(v)) { errors.type = 'must be bar, cafe, or venue'; continue; }
    } else {
      if (typeof v !== 'string') { errors[field] = 'must be text'; continue; }
      const trimmed = v.trim();
      if (REQUIRED_SIMPLE_FIELDS.has(field) && !trimmed) { errors[field] = `${field} can't be empty`; continue; }
      if (trimmed.length > MAX_LEN[field]) {
        errors[field] = `must be ${MAX_LEN[field]} characters or fewer`;
        continue;
      }
    }
    sets.push(`${field} = ?`);
    binds.push(field === 'type' ? v : v.trim());
  }
}
