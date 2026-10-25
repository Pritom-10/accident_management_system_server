const express = require('express');
const router = express.Router();

const PushSubscription = require('../models/PushSubscription');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { ipHash } = require('../utils/money');
const { configured, deliver, publicKey } = require('../utils/push');

const ENDPOINT_RE =
  /^https:\/\/([a-z0-9-]+\.)*(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)\//i;
const KEY_RE = /^[A-Za-z0-9_-]{8,200}={0,2}$/;
const PREF_KEYS = ['sos', 'blood', 'news', 'campaigns'];
const DAY = 24 * 60 * 60 * 1000;

const str = (v, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => res.status(500).json({ error: err.message }));

const defaultPrefs = (user) => ({
  sos: Boolean(user && user.roles.includes('volunteer')),
  blood: true,
  news: true,
  campaigns: true,
});

const prefsOf = (sub) => ({
  sos: Boolean(sub.prefs.sos),
  blood: Boolean(sub.prefs.blood),
  news: Boolean(sub.prefs.news),
  campaigns: Boolean(sub.prefs.campaigns),
});

function mergePrefs(input, base) {
  const out = { ...base };
  PREF_KEYS.forEach((k) => {
    if (input && typeof input[k] === 'boolean') out[k] = input[k];
  });
  return out;
}

const view = (sub) => ({
  subscribed: true,
  prefs: prefsOf(sub),
  district: sub.district || '',
  attached: Boolean(sub.user),
});

router.get('/public-key', (req, res) => {
  res.json({ key: configured() ? publicKey() : null });
});

router.post('/subscribe', optionalAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const s = b.subscription || {};
  const endpoint = str(s.endpoint, 1000);
  const p256dh = str(s.keys && s.keys.p256dh, 220);
  const auth = str(s.keys && s.keys.auth, 220);

  if (!ENDPOINT_RE.test(endpoint) || !KEY_RE.test(p256dh) || !KEY_RE.test(auth)) {
    return res.status(400).json({ error: 'This device could not be registered' });
  }

  const user = req.user;
  let sub = await PushSubscription.findOne({ endpoint });

  if (!sub) {
    const hash = ipHash(req.ip);
    const recent = await PushSubscription.countDocuments({
      ipHash: hash,
      createdAt: { $gte: new Date(Date.now() - DAY) },
    });
    if (recent >= 10) {
      return res.status(429).json({ error: 'Too many devices from this connection. Please try again tomorrow.' });
    }

    sub = new PushSubscription({
      endpoint,
      ipHash: hash,
      prefs: defaultPrefs(user),
      district: user && user.address && user.address.district ? user.address.district : '',
    });
  }

  sub.keys = { p256dh, auth };
  sub.failures = 0;

  if (user) {
    if (!sub.user || String(sub.user) !== String(user._id)) {
      const owned = await PushSubscription.countDocuments({ user: user._id, endpoint: { $ne: endpoint } });
      if (owned >= 8) return res.status(429).json({ error: 'You have too many devices. Turn alerts off on one first.' });

      sub.user = user._id;
      if (!b.prefs) sub.prefs = defaultPrefs(user);
    }
  }

  if (b.prefs) sub.prefs = mergePrefs(b.prefs, prefsOf(sub));
  if (typeof b.district === 'string') sub.district = str(b.district, 50);

  await sub.save();
  res.json({ ok: true, ...view(sub) });
}));

router.post('/state', wrap(async (req, res) => {
  const endpoint = str(req.body && req.body.endpoint, 1000);
  const sub = endpoint ? await PushSubscription.findOne({ endpoint }).lean() : null;
  if (!sub) return res.json({ subscribed: false });
  res.json(view(sub));
}));

router.post('/unsubscribe', wrap(async (req, res) => {
  const endpoint = str(req.body && req.body.endpoint, 1000);
  if (endpoint) await PushSubscription.deleteOne({ endpoint });
  res.json({ ok: true });
}));

router.post('/detach', requireAuth, wrap(async (req, res) => {
  const endpoint = str(req.body && req.body.endpoint, 1000);
  if (endpoint) {
    await PushSubscription.updateOne(
      { endpoint, user: req.user._id },
      { $unset: { user: 1 }, $set: { 'prefs.sos': false, 'prefs.blood': false, 'prefs.campaigns': false } }
    );
  }
  res.json({ ok: true });
}));

router.post('/test', wrap(async (req, res) => {
  if (!configured()) return res.status(503).json({ error: 'Alerts are not set up on the server yet' });

  const endpoint = str(req.body && req.body.endpoint, 1000);
  const sub = endpoint ? await PushSubscription.findOne({ endpoint }) : null;
  if (!sub) return res.status(404).json({ error: 'This device is not registered' });

  if (sub.lastSentAt && Date.now() - sub.lastSentAt.getTime() < 15000) {
    return res.status(429).json({ error: 'Please wait a few seconds' });
  }

  const sent = await deliver(
    [sub],
    { title: 'Sahayota alerts are on', body: 'You will see alerts like this one on this device.', url: '/notifications', tag: 'test' },
    { ttl: 60 }
  );
  if (!sent) return res.status(502).json({ error: 'Could not reach this device. Try turning alerts off and on again.' });

  res.json({ ok: true });
}));

router.get('/email-prefs', requireAuth, (req, res) => {
  const u = req.user;
  res.json({
    hasEmail: Boolean(u.email),
    isDonor: Boolean(u.donor && u.donor.isDonor),
    donorEmail: Boolean(u.donor && u.donor.emailAlerts !== false),
    isVolunteer: u.roles.includes('volunteer'),
    sosEmail: Boolean(u.volunteer && u.volunteer.availability === 'available'),
  });
});

router.patch('/email-prefs', requireAuth, wrap(async (req, res) => {
  const u = req.user;
  const b = req.body || {};

  if (typeof b.donorEmail === 'boolean' && u.donor && u.donor.isDonor) u.donor.emailAlerts = b.donorEmail;
  if (typeof b.sosEmail === 'boolean' && u.roles.includes('volunteer')) {
    u.volunteer.availability = b.sosEmail ? 'available' : 'unavailable';
  }

  await u.save();
  res.json({ ok: true });
}));

module.exports = router;