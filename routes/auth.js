const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { normalizeBdNumber } = require('../utils/phone');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SKILLS = ['first_aid', 'driving', 'other'];
const str = (v) => (typeof v === 'string' ? v.trim() : '');

function makeToken(user) {
  return jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
}


router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password, wantsToVolunteer, skills, serviceArea } = req.body || {};

    const cleanEmail = str(email).toLowerCase();
    const cleanPhone = str(phone) ? normalizeBdNumber(phone) : null;

    if (!str(name)) return res.status(400).json({ error: 'Name is required' });
    if (!cleanEmail && !str(phone)) {
      return res.status(400).json({ error: 'Enter an email or a mobile number' });
    }
    if (cleanEmail && !EMAIL_RE.test(cleanEmail)) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }
    if (str(phone) && !cleanPhone) {
      return res.status(400).json({ error: 'Enter a valid Bangladeshi mobile number, like 01712345678' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    if (cleanEmail && (await User.findOne({ email: cleanEmail }))) {
      return res.status(409).json({ error: 'This email is already registered' });
    }
    if (cleanPhone && (await User.findOne({ phone: cleanPhone }))) {
      return res.status(409).json({ error: 'This mobile number is already registered' });
    }


    const user = new User({
      name: str(name),
      email: cleanEmail || undefined,
      phone: cleanPhone || undefined,
      passwordHash: await bcrypt.hash(password, 10),
    });

    if (wantsToVolunteer === true) {
      const area = serviceArea || {};
      user.volunteer.status = 'pending'; // an admin approves it later
      user.volunteer.skills = Array.isArray(skills) ? skills.filter((s) => SKILLS.includes(s)) : [];
      user.volunteer.serviceArea = {
        division: str(area.division),
        district: str(area.district),
        area: str(area.area),
      };
    }

    await user.save();
    res.status(201).json({ token: makeToken(user), user: user.toPublic() });
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
    if (!id || typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Enter your email or mobile number and password' });
    }

    const query = id.includes('@') ? { email: id.toLowerCase() } : { phone: normalizeBdNumber(id) };
    const wrong = { error: 'Wrong email/mobile number or password' };
    if (query.phone === null) return res.status(401).json(wrong);

    const user = await User.findOne(query);
    const ok = user && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) return res.status(401).json(wrong);
    if (user.isBlocked) return res.status(403).json({ error: 'This account is blocked' });

    res.json({ token: makeToken(user), user: user.toPublic() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toPublic() });
});

module.exports = router;