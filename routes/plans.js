const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const router = express.Router();

const DonationPlan = require('../models/DonationPlan');
const Campaign = require('../models/Campaign');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { LIMITS, readWhole } = require('../utils/money');
const { pushToUsers } = require('../utils/push');
const { sendMail } = require('../utils/mailer');

const DAY = 24 * 60 * 60 * 1000;
const taka = (n) => `৳${Number(n).toLocaleString('en-IN')}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => res.status(500).json({ error: err.message }));

function addPeriod(date, frequency) {
  if (frequency === 'weekly') return new Date(date.getTime() + 7 * DAY);
  const d = new Date(date);
  d.setMonth(d.getMonth() + 1);
  return d;
}

function nextAfter(from, frequency, now) {
  let d = addPeriod(new Date(from), frequency);
  while (d <= now) d = addPeriod(d, frequency);
  return d;
}

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

router.get('/run', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: 'CRON_SECRET is not set' });

  const header = req.get('authorization') || '';
  if (!header.startsWith('Bearer ') || !same(header.slice(7), secret)) return res.status(401).json({ error: 'Not allowed' });

  try {
    const now = new Date();
    const due = await DonationPlan.find({ active: true, nextDue: { $lte: now } })
      .sort({ nextDue: 1 })
      .limit(60)
      .populate('campaign', 'title status')
      .lean();

    const site = String(process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
    let sent = 0;
    let stopped = 0;

    for (let i = 0; i < due.length; i += 10) {
      await Promise.all(
        due.slice(i, i + 10).map(async (plan) => {
          try {
            const c = plan.campaign;
            const user = await User.findById(plan.user).select('email isBlocked deletedAt').lean();

            if (!c || c.status !== 'active' || !user || user.isBlocked || user.deletedAt) {
              await DonationPlan.updateOne({ _id: plan._id }, { $set: { active: false } });
              stopped += 1;
              return;
            }

            const url = `/donate/${c._id}`;
            const body = `Your ${plan.frequency} reminder: you planned to give ${taka(plan.amount)} by ${plan.method}.`;

            const delivered = await pushToUsers(
              [plan.user],
              'campaigns',
              { title: `Time to help again: ${String(c.title).slice(0, 60)}`, body, url, tag: `plan-${plan._id}` },
              { ttl: DAY / 1000 }
            );

            if (!delivered && user.email) {
              await sendMail({
                to: user.email,
                subject: `Your ${plan.frequency} reminder to help`,
                text: `${body}\n\n${site}${url}\n\nYou can stop these reminders on your campaigns and donations page.`,
                html: `<p>${esc(body)}</p><p><a href="${esc(site + url)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#059669;color:#ffffff;text-decoration:none;font-weight:600">Open ${esc(c.title)}</a></p><p style="color:#64748B;font-size:12px">You can stop these reminders on your campaigns and donations page.</p>`,
              });
            }

            await DonationPlan.updateOne(
              { _id: plan._id },
              { $set: { nextDue: nextAfter(plan.nextDue, plan.frequency, now), lastRemindedAt: now }, $inc: { remindedCount: 1 } }
            );
            sent += 1;
          } catch (err) {
            console.error('plan reminder failed:', err.message);
          }
        })
      );
    }

    res.json({ checked: due.length, sent, stopped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', requireAuth, wrap(async (req, res) => {
  const plans = await DonationPlan.find({ user: req.user._id, active: true })
    .populate('campaign', 'title status')
    .sort({ nextDue: 1 })
    .lean();

  res.json(
    plans.map((p) => ({
      _id: p._id,
      amount: p.amount,
      method: p.method,
      frequency: p.frequency,
      nextDue: p.nextDue,
      campaign: p.campaign ? { _id: p.campaign._id, title: p.campaign.title, status: p.campaign.status } : null,
    }))
  );
}));

router.post('/', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!mongoose.isValidObjectId(b.campaignId)) return res.status(400).json({ error: 'Choose a campaign' });

  const campaign = await Campaign.findById(b.campaignId).select('status paymentAccounts');
  if (!campaign || campaign.status !== 'active') return res.status(400).json({ error: 'This campaign is not taking donations now' });

  const method = typeof b.method === 'string' ? b.method : '';
  if (!campaign.paymentAccounts.some((a) => a.method === method)) {
    return res.status(400).json({ error: 'This campaign does not accept that payment method' });
  }

  const amount = readWhole(b.amount, LIMITS.minDonation, LIMITS.maxDonation);
  if (amount === null) return res.status(400).json({ error: 'Enter an amount from ৳10 to ৳50,00,000' });

  const frequency = ['weekly', 'monthly'].includes(b.frequency) ? b.frequency : null;
  if (!frequency) return res.status(400).json({ error: 'Choose weekly or monthly' });

  const existing = await DonationPlan.exists({ user: req.user._id, campaign: campaign._id });
  if (!existing && (await DonationPlan.countDocuments({ user: req.user._id, active: true })) >= 10) {
    return res.status(429).json({ error: 'You already have 10 reminders. Stop one first.' });
  }

  const plan = await DonationPlan.findOneAndUpdate(
    { user: req.user._id, campaign: campaign._id },
    { $set: { amount, method, frequency, nextDue: addPeriod(new Date(), frequency), active: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  res.status(201).json({ id: plan._id, nextDue: plan.nextDue });
}));

router.delete('/:id', requireAuth, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Not found' });
  await DonationPlan.deleteOne({ _id: req.params.id, user: req.user._id });
  res.json({ ok: true });
}));

module.exports = router;