const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const router = express.Router();

const SosAlert = require('../models/SosAlert');
const BlockedPhone = require('../models/BlockedPhone');
const { withTimeout } = require('../utils/push');
const { pushSos } = require('../utils/pushNotify');
const { requireAuth, optionalAuth, requireRole } = require('../middleware/auth');
const { normalizeBdNumber } = require('../utils/phone');
const { ipHash } = require('../utils/money');
const { insideBangladesh, roundCoord, activeSince, distanceKm, boundingBox } = require('../utils/sos');
const { notifyVolunteersByEmail } = require('../utils/sosNotify');

const TOKEN_RE = /^[a-f0-9]{24}$/;
const HOUR = 60 * 60 * 1000;
const RADII = [1, 2, 5, 10];
const RESPONSES = ['on_the_way', 'arrived', 'cannot'];

const str = (v, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => res.status(500).json({ error: err.message }));
const hasNumber = (v) => v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v));

router.param('id', (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) return res.status(404).json({ error: 'Not found' });
  next();
});

router.post('/', optionalAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const loc = b.location || {};
  const user = req.user;

  let lat;
  let lng;
  let accuracy;
  if (hasNumber(loc.lat)) {
    lat = Number(loc.lat);
    lng = Number(loc.lng);
    if (!Number.isFinite(lng) || !insideBangladesh(lat, lng)) {
      return res.status(400).json({ error: 'Your location must be inside Bangladesh' });
    }
    const acc = Number(loc.accuracy);
    accuracy = Number.isFinite(acc) && acc >= 0 && acc < 100000 ? Math.round(acc) : undefined;
  }

  const division = str(loc.division, 50);
  const district = str(loc.district, 50);
  const area = str(loc.area, 50);
  if (lat === undefined && !district) {
    return res.status(400).json({ error: 'Turn on your location, or choose your district' });
  }

  const phoneRaw = str(b.callerPhone, 20) || (user && (user.phone || (user.donor && user.donor.contactPhone))) || '';
  let phone = '';
  if (phoneRaw) {
    phone = normalizeBdNumber(phoneRaw);
    if (!phone) return res.status(400).json({ error: 'Enter a valid Bangladeshi mobile number, like 01712345678' });
    if (await BlockedPhone.exists({ phone })) {
      return res.status(403).json({ error: 'This mobile number is not allowed to send alerts. Please call 999.' });
    }
  }

  const hash = ipHash(req.ip);
  const recent = await SosAlert.find({ ipHash: hash, createdAt: { $gte: new Date(Date.now() - HOUR) } })
    .sort({ createdAt: -1 })
    .select('token status createdAt')
    .lean();

  const running = recent.find((r) => r.status === 'active' && Date.now() - new Date(r.createdAt).getTime() < 5 * 60 * 1000);
  if (running) return res.json({ token: running.token, existing: true });
  if (recent.length >= 3) {
    return res.status(429).json({ error: 'Too many alerts from this connection. Please call 999.' });
  }

  const alert = await SosAlert.create({
    token: crypto.randomBytes(12).toString('hex'),
    caller: user ? user._id : undefined,
    callerName: str(b.callerName, 60) || (user ? user.name : ''),
    callerPhone: phone || undefined,
    note: str(b.note, 200),
    location: { lat, lng, accuracy, division, district, area },
    ipHash: hash,
  });

   const [mail, push] = await Promise.allSettled([
    withTimeout(notifyVolunteersByEmail(alert), 4000),
    withTimeout(pushSos(alert), 4000),
  ]);
  const emailed = mail.status === 'fulfilled' ? mail.value || 0 : 0;
  const pushed = push.status === 'fulfilled' ? push.value || 0 : 0;

  res.status(201).json({ token: alert.token, status: alert.status, emailed, pushed });
}));

router.get('/status/:token', wrap(async (req, res) => {
  if (!TOKEN_RE.test(req.params.token)) return res.status(404).json({ error: 'Not found' });

  const alert = await SosAlert.findOne({ token: req.params.token }).lean();
  if (!alert) return res.status(404).json({ error: 'Not found' });

  res.json({
    status: alert.status,
    expired: alert.status === 'active' && new Date(alert.createdAt) < activeSince(),
    createdAt: alert.createdAt,
    location: {
      lat: alert.location.lat,
      lng: alert.location.lng,
      division: alert.location.division,
      district: alert.location.district,
      area: alert.location.area,
    },
    responders: (alert.responders || [])
      .filter((r) => r.status !== 'cannot')
      .map((r) => ({ name: String(r.name || 'A volunteer').split(' ')[0], status: r.status, at: r.at })),
  });
}));

router.patch('/status/:token/cancel', wrap(async (req, res) => {
  if (!TOKEN_RE.test(req.params.token)) return res.status(404).json({ error: 'Not found' });

  const alert = await SosAlert.findOne({ token: req.params.token });
  if (!alert) return res.status(404).json({ error: 'Not found' });
  if (alert.status !== 'active') return res.status(400).json({ error: 'This alert is already closed' });

  alert.status = 'cancelled';
  alert.resolvedAt = new Date();
  await alert.save();
  res.json({ ok: true });
}));

router.get('/nearby', requireAuth, wrap(async (req, res) => {
  const user = req.user;
  const isVolunteer = user.roles.includes('volunteer') || user.roles.includes('admin');
  const isDonor = Boolean(user.donor && user.donor.isDonor);
  if (!isVolunteer && !isDonor) {
    return res.status(403).json({ error: 'Only volunteers and registered blood donors can see nearby alerts' });
  }

  const radius = RADII.includes(Number(req.query.radius)) ? Number(req.query.radius) : 2;
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const hasPos = hasNumber(req.query.lat) && hasNumber(req.query.lng) && insideBangladesh(lat, lng);

  const query = { status: 'active', createdAt: { $gte: activeSince() } };
  let mode = 'radius';

  if (hasPos) {
    const box = boundingBox(lat, lng, radius + 1);
    query['location.lat'] = { $gte: box.minLat, $lte: box.maxLat };
    query['location.lng'] = { $gte: box.minLng, $lte: box.maxLng };
  } else {
    mode = 'district';
    const district =
      (user.volunteer && user.volunteer.serviceArea && user.volunteer.serviceArea.district) ||
      (user.address && user.address.district);
    if (!district) return res.json({ mode: 'none', radius, items: [] });
    query['location.district'] = district;
  }

  const alerts = await SosAlert.find(query).sort({ createdAt: -1 }).limit(100).lean();

  const rows = alerts
    .map((a) => {
      const exact = typeof a.location.lat === 'number' && typeof a.location.lng === 'number';
      const shownLat = exact ? (isVolunteer ? a.location.lat : roundCoord(a.location.lat)) : null;
      const shownLng = exact ? (isVolunteer ? a.location.lng : roundCoord(a.location.lng)) : null;
      const dist = hasPos && exact ? distanceKm(lat, lng, shownLat, shownLng) : null;
      return { a, shownLat, shownLng, dist };
    })
    .filter((r) => mode !== 'radius' || (r.dist !== null && r.dist <= radius));

  if (mode === 'radius') rows.sort((x, y) => x.dist - y.dist);

  const items = rows.map(({ a, shownLat, shownLng, dist }) => {
    const base = {
      id: a._id,
      createdAt: a.createdAt,
      distanceKm: dist === null ? null : Math.round(dist * 10) / 10,
      location: { lat: shownLat, lng: shownLng, district: a.location.district, area: a.location.area },
    };

    if (isVolunteer) {
      const mine = (a.responders || []).find((r) => String(r.user) === String(user._id));
      return {
        ...base,
        details: true,
        callerName: a.callerName,
        callerPhone: a.callerPhone,
        note: a.note,
        location: { ...base.location, accuracy: a.location.accuracy },
        responders: (a.responders || []).map((r) => ({ name: r.name, status: r.status, at: r.at })),
        myStatus: mine ? mine.status : null,
      };
    }

    return {
      ...base,
      details: false,
      responderCount: (a.responders || []).filter((r) => r.status !== 'cannot').length,
    };
  });

  res.json({ mode, radius, items });
}));

router.post('/alerts/:id/respond', requireAuth, requireRole('volunteer', 'admin'), wrap(async (req, res) => {
  const status = req.body && req.body.status;
  if (!RESPONSES.includes(status)) return res.status(400).json({ error: 'Invalid response' });

  const alert = await SosAlert.findById(req.params.id);
  if (!alert) return res.status(404).json({ error: 'Not found' });
  if (alert.status !== 'active' || new Date(alert.createdAt) < activeSince()) {
    return res.status(400).json({ error: 'This alert is closed' });
  }

  const existing = alert.responders.find((r) => String(r.user) === String(req.user._id));
  if (existing) {
    existing.status = status;
    existing.at = new Date();
  } else {
    alert.responders.push({
      user: req.user._id,
      name: req.user.name,
      phone: req.user.phone,
      status,
    });
  }

  await alert.save();
  res.json({ ok: true });
}));

router.patch('/availability', requireAuth, requireRole('volunteer'), wrap(async (req, res) => {
  const value = req.body && req.body.availability;
  if (!['available', 'unavailable'].includes(value)) return res.status(400).json({ error: 'Invalid value' });

  req.user.volunteer.availability = value;
  await req.user.save();
  res.json({ user: req.user.toPublic() });
}));

module.exports = router;