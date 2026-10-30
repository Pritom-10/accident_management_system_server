const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

const TOKEN_RE = /^[a-f0-9]{24}$/;
const str = (v, max = 300) => (typeof v === 'string' ? v.trim().replace(/\r/g, '').slice(0, max) : '');
const newToken = () => crypto.randomBytes(12).toString('hex');
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => res.status(500).json({ error: err.message }));

function shape(u) {
  const m = u.medicalId || {};
  return {
    enabled: Boolean(m.enabled),
    token: m.token || null,
    allergies: m.allergies || '',
    conditions: m.conditions || '',
    medications: m.medications || '',
    notes: m.notes || '',
    showPhone: m.showPhone !== false,
  };
}

router.get('/view/:token', wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex');
  if (!TOKEN_RE.test(req.params.token)) return res.status(404).json({ error: 'Not found' });

  const u = await User.findOne({ 'medicalId.token': req.params.token, 'medicalId.enabled': true });
  if (!u || u.isBlocked || u.deletedAt) return res.status(404).json({ error: 'Not found' });

  const m = u.medicalId;
  const ec = u.emergencyContact || {};

  res.json({
    name: u.name,
    bloodGroup: u.bloodGroup || null,
    allergies: m.allergies || '',
    conditions: m.conditions || '',
    medications: m.medications || '',
    notes: m.notes || '',
    emergencyContact: m.showPhone !== false && ec.phone ? { name: ec.name || '', phone: ec.phone } : null,
    verified: Boolean(u.verification && u.verification.status === 'approved'),
  });
}));

router.get('/me', requireAuth, (req, res) => {
  res.json(shape(req.user));
});

router.put('/me', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const u = req.user;
  const m = u.medicalId || {};

  const enabled = b.enabled === true;
  u.medicalId = {
    enabled,
    token: m.token || (enabled ? newToken() : undefined),
    allergies: str(b.allergies),
    conditions: str(b.conditions),
    medications: str(b.medications),
    notes: str(b.notes),
    showPhone: b.showPhone !== false,
  };

  await u.save();
  res.json(shape(u));
}));

router.post('/me/regenerate', requireAuth, wrap(async (req, res) => {
  req.user.medicalId = { ...(req.user.medicalId ? req.user.medicalId.toObject() : {}), token: newToken() };
  await req.user.save();
  res.json(shape(req.user));
}));

module.exports = router;