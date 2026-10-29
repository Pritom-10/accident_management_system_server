const { BLOOD_GROUPS } = require('./blood');

const STALE_MS = 24 * 60 * 60 * 1000;
const KEYS = { 'A+': 'Ap', 'A-': 'An', 'B+': 'Bp', 'B-': 'Bn', 'AB+': 'ABp', 'AB-': 'ABn', 'O+': 'Op', 'O-': 'On' };

const whole = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;

function levelOf(available, total) {
  if (!Number.isInteger(total) || !Number.isInteger(available)) return null;
  if (total === 0) return 'none';
  if (available <= 0) return 'full';
  return available / total <= 0.2 ? 'low' : 'ok';
}

function shapeCounts(c) {
  if (!c || !Number.isInteger(c.total)) return null;
  const available = Number.isInteger(c.available) ? c.available : 0;
  return { total: c.total, available, level: levelOf(available, c.total) };
}

function shapeStock(stock) {
  if (!stock) return null;
  const out = {};
  BLOOD_GROUPS.forEach((g) => {
    if (Number.isInteger(stock[KEYS[g]])) out[g] = stock[KEYS[g]];
  });
  return Object.keys(out).length ? out : null;
}

function shapeStatus(h) {
  if (!h.statusUpdatedAt) return null;

  const at = new Date(h.statusUpdatedAt);
  return {
    beds: shapeCounts(h.beds),
    icu: shapeCounts(h.icu),
    bloodStock: shapeStock(h.bloodStock),
    accepting: h.acceptingEmergency !== false,
    updatedAt: at,
    stale: Date.now() - at.getTime() > STALE_MS,
  };
}

function readStatus(b = {}) {
  const set = {};

  for (const key of ['beds', 'icu']) {
    const part = b[key];
    if (part === undefined || part === null) continue;

    const label = key === 'beds' ? 'beds' : 'ICU beds';
    const total = Number(part.total);
    const available = Number(part.available);

    if (!whole(total, 5000)) return { error: `Enter the total number of ${label}` };
    if (!whole(available, 5000)) return { error: `Enter how many ${label} are free` };
    if (available > total) return { error: `Free ${label} cannot be more than the total` };

    set[`${key}.total`] = total;
    set[`${key}.available`] = available;
  }

  if (b.bloodStock && typeof b.bloodStock === 'object') {
    for (const g of BLOOD_GROUPS) {
      const v = b.bloodStock[g];
      if (v === undefined || v === null || v === '') continue;

      const n = Number(v);
      if (!whole(n, 9999)) return { error: `Blood stock for ${g} must be a whole number` };
      set[`bloodStock.${KEYS[g]}`] = n;
    }
  }

  if (typeof b.acceptingEmergency === 'boolean') set.acceptingEmergency = b.acceptingEmergency;

  if (Object.keys(set).length === 0) return { error: 'There is nothing to save' };
  return { data: set };
}

module.exports = { STALE_MS, KEYS, levelOf, shapeStatus, readStatus };