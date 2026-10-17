const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { normalizeBdNumber } = require('../utils/phone');

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const str = (v, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : '');


router.use(requireAuth);


router.put('/', async (req, res) => {
  try {
    const b = req.body || {};
    const user = req.user;

    const name = str(b.name);
    if (!name) return res.status(400).json({ error: 'Name is required' });
    user.name = name;

    const photoUrl = str(b.photoUrl, 500);
    if (photoUrl && !/^(https?:\/\/|\/api\/)/i.test(photoUrl)) {
      return res.status(400).json({ error: 'Invalid photo link' });
    }
    user.photoUrl = photoUrl || undefined;

    const blood = str(b.bloodGroup, 5);
    if (blood && !BLOOD_GROUPS.includes(blood)) {
      return res.status(400).json({ error: 'Invalid blood group' });
    }
    user.bloodGroup = blood || undefined;

    const a = b.address || {};
    user.address = {
      division: str(a.division),
      district: str(a.district),
      area: str(a.area),
      details: str(a.details, 200),
    };

    const ec = b.emergencyContact || {};
    const ecPhoneRaw = str(ec.phone, 20);
    let ecPhone = '';
    if (ecPhoneRaw) {
      ecPhone = normalizeBdNumber(ecPhoneRaw);
      if (!ecPhone) {
        return res.status(400).json({ error: 'Enter a valid Bangladeshi number for the emergency contact' });
      }
    }
    user.emergencyContact = { name: str(ec.name), phone: ecPhone };

  
    await user.save();
    res.json({ user: user.toPublic() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


router.put('/password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'Enter your current and new password' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const ok = await bcrypt.compare(currentPassword, req.user.passwordHash);
    if (!ok) return res.status(400).json({ error: 'Your current password is wrong' });

    req.user.passwordHash = await bcrypt.hash(newPassword, 10);
    await req.user.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;