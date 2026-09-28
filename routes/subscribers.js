const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const Subscriber = require('../models/Subscriber');

// POST subscribe to district notifications (1.11)
router.post('/', async (req, res) => {
  try {
    const { email, division, district } = req.body;
    if (!email || !division || !district) {
      return res.status(400).json({ error: 'email, division and district are required' });
    }

    const existing = await Subscriber.findOne({ email: email.toLowerCase(), division, district });
    if (existing) {
      existing.isActive = true; // re-subscribe if they had unsubscribed
      await existing.save();
      return res.json({ ok: true });
    }

    await Subscriber.create({
      email,
      division,
      district,
      unsubscribeToken: crypto.randomBytes(16).toString('hex'),
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
