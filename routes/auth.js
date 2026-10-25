const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { normalizeBdNumber } = require('../utils/phone');
const { signToken } = require('../utils/token');
const { checkPassword } = require('../utils/password');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SKILLS = ['first_aid', 'driving', 'other'];
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const str = (v) => (typeof v === 'string' ? v.trim() : '');

router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password, wantsToVolunteer, skills, serviceArea } = req.body || {};

    const cleanEmail = str(email).toLowerCase();
    const cleanPhone = str(phone) ? normalizeBdNumber(phone) : null;

    if (!str(name)) return res.status(400).json({ error: 'Name is required' });
    if (!cleanEmail && !str(phone)) return res.status(400).json({ error: 'Enter an email or a mobile number' });
    if (cleanEmail && !EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: 'Enter a valid email address' });
    if (str(phone) && !cleanPhone) {
      return res.status(400).json({ error: 'Enter a valid Bangladeshi mobile number, like 01712345678' });
    }

    const weak = checkPassword(password, { email: cleanEmail, phone: cleanPhone });
    if (weak) return res.status(400).json({ error: weak });

    if (cleanEmail && (await User.findOne({ email: cleanEmail }))) {
      return res.status(409).json({ error: 'This email is already registered' });
    }
    if (cleanPhone && (await User.findOne({ phone: cleanPhone }))) {
      return res.status(409).json({ error: 'This mobile number is already registered' });
    }

    const user = new User({
      name: str(name).slice(0, 80),
      email: cleanEmail || undefined,
      phone: cleanPhone || undefined,
      passwordHash: await bcrypt.hash(password, 10),
    });

    if (wantsToVolunteer === true) {
      const area = serviceArea || {};
      user.volunteer.status = 'pending';
      user.volunteer.skills = Array.isArray(skills) ? skills.filter((s) => SKILLS.includes(s)) : [];
      user.volunteer.serviceArea = {
        division: str(area.division),
        district: str(area.district),
        area: str(area.area),
      };
    }

    await user.save();
    res.status(201).json({ token: signToken(user), user: user.toPublic() });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'This email or mobile number is already registered' });
    }
    res.status(400).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body || {};
    const id = str(identifier);
    if (!id || typeof password !== 'string' || !password || password.length > 200) {
      return res.status(400).json({ error: 'Enter your email or mobile number and password' });
    }

    const wrong = { error: 'Wrong email/mobile number or password' };
    const query = id.includes('@') ? { email: id.toLowerCase() } : { phone: normalizeBdNumber(id) };

    if (query.phone === null) {
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(401).json(wrong);
    }

    const user = await User.findOne(query);
    if (!user || user.deletedAt) {
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(401).json(wrong);
    }

    const sec = user.security || {};
    if (sec.lockUntil && sec.lockUntil > new Date()) {
      const minutes = Math.ceil((sec.lockUntil.getTime() - Date.now()) / 60000);
      return res.status(429).json({
        error: `Too many wrong attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, or reset your password.`,
      });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      const updated = await User.findByIdAndUpdate(user._id, { $inc: { 'security.failedLogins': 1 } }, { new: true });
      if (updated && updated.security.failedLogins >= MAX_FAILS) {
        await User.updateOne(
          { _id: user._id },
          { $set: { 'security.failedLogins': 0, 'security.lockUntil': new Date(Date.now() + LOCK_MS) } }
        );
      }
      return res.status(401).json(wrong);
    }

    if (user.isBlocked) return res.status(403).json({ error: 'This account is blocked' });

    if (sec.failedLogins || sec.lockUntil) {
      await User.updateOne({ _id: user._id }, { $set: { 'security.failedLogins': 0 }, $unset: { 'security.lockUntil': 1 } });
    }

    res.json({ token: signToken(user), user: user.toPublic() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toPublic() });
});

router.post('/logout-all', requireAuth, async (req, res) => {
  try {
    await User.updateOne({ _id: req.user._id }, { $inc: { 'security.tokenVersion': 1 } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;