const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const router = express.Router();
const User = require('../models/User');
const { sendMail } = require('../utils/mailer');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_MINUTES = 10; 
const RESEND_SECONDS = 60; 
const MAX_ATTEMPTS = 5; 

const clean = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');


router.post('/forgot-password', async (req, res) => {
  try {
    const email = clean(req.body?.email);
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }

    const user = await User.findOne({ email });

    if (user && !user.isBlocked) {
      const last = user.reset?.requestedAt;
      const tooSoon = last && Date.now() - new Date(last).getTime() < RESEND_SECONDS * 1000;

      if (!tooSoon) {
        const otp = String(crypto.randomInt(100000, 1000000)); // 6 digits
        user.reset = {
          otpHash: await bcrypt.hash(otp, 8),
          expiresAt: new Date(Date.now() + OTP_MINUTES * 60 * 1000),
          attempts: 0,
          requestedAt: new Date(),
        };
        await user.save();

        await sendMail({
          to: email,
          subject: 'Your Sahayota password reset code',
          text: `Your code is ${otp}\n\nIt works for ${OTP_MINUTES} minutes. If you did not ask for this, ignore this email.`,
          html: `<p>Your Sahayota password reset code is:</p>
                 <p style="font-size:28px;font-weight:700;letter-spacing:6px">${otp}</p>
                 <p>It works for ${OTP_MINUTES} minutes. If you did not ask for this, ignore this email.</p>`,
        });
      }
    }

    res.json({
      ok: true,
      message: `If this email is registered, a 6-digit code has been sent. It works for ${OTP_MINUTES} minutes.`,
    });
  } catch (err) {
    console.error('forgot-password failed:', err.message);
    res.status(500).json({ error: 'Could not send the code. Please try again later.' });
  }
});


router.post('/reset-password', async (req, res) => {
  try {
    const { otp, newPassword } = req.body || {};
    const email = clean(req.body?.email);
    const bad = { error: 'The code is wrong or has expired' };

    if (!EMAIL_RE.test(email) || typeof otp !== 'string' || !/^\d{6}$/.test(otp.trim())) {
      return res.status(400).json(bad);
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const user = await User.findOne({ email });
    const r = user?.reset;

    if (!user || !r?.otpHash || !r.expiresAt || r.expiresAt < new Date() || (r.attempts || 0) >= MAX_ATTEMPTS) {
      return res.status(400).json(bad);
    }

    const ok = await bcrypt.compare(otp.trim(), r.otpHash);
    if (!ok) {
      user.reset.attempts = (r.attempts || 0) + 1;
      await user.save();
      return res.status(400).json(bad);
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.reset = undefined; 
    await user.save();

    res.json({ ok: true });
  } catch (err) {
    console.error('reset-password failed:', err.message);
    res.status(500).json({ error: 'Could not reset the password. Please try again.' });
  }
});

module.exports = router;