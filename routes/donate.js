const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const Campaign = require('../models/Campaign');
const Donation = require('../models/Donation');
const { withTimeout } = require('../utils/push');
const { pushDonationConfirmed, pushExpenseAdded } = require('../utils/pushNotify');
const Expense = require('../models/Expense');
const Image = require('../models/Image');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { normalizeBdNumber } = require('../utils/phone');
const { logAction } = require('../utils/audit');
const { LIMITS, text, longText, readWhole, readAccount, readTrxId, receiptNumber, ipHash } = require('../utils/money');
const { notifyOwnerOfDonation, sendReceiptEmail } = require('../utils/donateNotify');

const LISTED = ['active', 'completed'];
const VISIBLE = ['active', 'completed', 'closed'];
const HOUR = 60 * 60 * 1000;
const PUBLIC_IMAGE_RE = /^(https?:\/\/|\/api\/images\/)/i;
const PRIVATE_IMAGE_RE = /^\/api\/private-images\/([a-f0-9]{24})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => res.status(500).json({ error: err.message }));
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isAdminUser = (u) => Boolean(u && u.roles.includes('admin'));
const isOwnerOf = (c, u) => Boolean(u && String(c.owner) === String(u._id));
const canManage = (c, u) => isOwnerOf(c, u) || isAdminUser(u);

function checkId(req, res, next, id) {
  if (!mongoose.isValidObjectId(id)) return res.status(404).json({ error: 'Not found' });
  next();
}
['id', 'donationId', 'expenseId'].forEach((name) => router.param(name, checkId));

async function recompute(campaignId) {
  const id = new mongoose.Types.ObjectId(String(campaignId));
  const [received, spent, campaign] = await Promise.all([
    Donation.aggregate([
      { $match: { campaign: id, status: 'confirmed' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Expense.aggregate([{ $match: { campaign: id } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Campaign.findById(id),
  ]);
  if (!campaign) return null;

  campaign.raised = received[0]?.total || 0;
  campaign.donorCount = received[0]?.count || 0;
  campaign.spent = spent[0]?.total || 0;
  if (campaign.status === 'active' && campaign.raised >= campaign.targetAmount) campaign.status = 'completed';

  await campaign.save();
  return campaign;
}

function shapeCampaign(campaign, viewer, detail = false) {
  const c = campaign.toObject ? campaign.toObject() : campaign;
  const manage = canManage(c, viewer);

  const out = {
    _id: c._id,
    title: c.title,
    patientName: c.patientName,
    hospital: c.hospital,
    location: c.location,
    targetAmount: c.targetAmount,
    raised: c.raised,
    spent: c.spent,
    donorCount: c.donorCount,
    photos: c.photos,
    status: c.status,
    isVerified: c.isVerified,
    ownerName: c.ownerName,
    createdAt: c.createdAt,
    story: detail ? c.story : c.story.slice(0, 180),
  };

  if (detail) {
    out.isOwner = isOwnerOf(c, viewer);
    out.canManage = manage;
    if (c.status === 'active' || manage) out.paymentAccounts = c.paymentAccounts;
    if (manage) {
      out.documents = c.documents;
      out.rejectionReason = c.rejectionReason;
    }
    if (isAdminUser(viewer)) out.flagCount = (c.flags || []).length;
  }
  return out;
}

router.get('/stats', wrap(async (req, res) => {
  const [active, totals, donations] = await Promise.all([
    Campaign.countDocuments({ status: 'active' }),
    Campaign.aggregate([{ $match: { status: { $in: VISIBLE } } }, { $group: { _id: null, raised: { $sum: '$raised' } } }]),
    Donation.countDocuments({ status: 'confirmed' }),
  ]);
  res.json({ activeCampaigns: active, raised: totals[0]?.raised || 0, donations });
}));

router.get('/campaigns', wrap(async (req, res) => {
  const filter = { status: { $in: LISTED } };
  if (['active', 'completed', 'closed'].includes(req.query.status)) filter.status = req.query.status;

  const division = text(req.query.division, 50);
  const district = text(req.query.district, 50);
  const area = text(req.query.area, 50);
  if (division) filter['location.division'] = division;
  if (district) filter['location.district'] = district;
  if (area) filter['location.area'] = area;

  const q = text(req.query.q, 60);
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ title: re }, { patientName: re }, { 'hospital.name': re }];
  }

  const limit = Math.min(24, Math.max(1, parseInt(req.query.limit, 10) || 9));
  const page = Math.min(1000, Math.max(1, parseInt(req.query.page, 10) || 1));

  const [total, items] = await Promise.all([
    Campaign.countDocuments(filter),
    Campaign.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  res.json({
    items: items.map((c) => shapeCampaign(c, null)),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
}));

router.get('/mine', requireAuth, wrap(async (req, res) => {
  const user = req.user;
  const [campaigns, donations] = await Promise.all([
    Campaign.find({ owner: user._id }).sort({ createdAt: -1 }).limit(50),
    Donation.find({ donor: user._id }).populate('campaign', 'title').sort({ createdAt: -1 }).limit(100).lean(),
  ]);

  res.json({
    campaigns: campaigns.map((c) => ({ ...shapeCampaign(c, user), rejectionReason: c.rejectionReason })),
    donations: donations.map((d) => ({
      _id: d._id,
      receiptNo: d.receiptNo,
      amount: d.amount,
      method: d.method,
      status: d.status,
      createdAt: d.createdAt,
      campaign: d.campaign ? { _id: d.campaign._id, title: d.campaign.title } : null,
    })),
  });
}));

router.get('/receipts/:receiptNo', wrap(async (req, res) => {
  const no = text(req.params.receiptNo, 30).toUpperCase();
  if (!/^DON-[A-F0-9]{12}$/.test(no)) return res.status(404).json({ error: 'Not found' });

  const d = await Donation.findOne({ receiptNo: no }).populate('campaign', 'title patientName hospital').lean();
  if (!d || !d.campaign) return res.status(404).json({ error: 'Not found' });

  res.json({
    receiptNo: d.receiptNo,
    donorName: d.donorName || 'Anonymous',
    amount: d.amount,
    method: d.method,
    trxId: d.trxId,
    status: d.status,
    rejectionReason: d.rejectionReason,
    createdAt: d.createdAt,
    confirmedAt: d.confirmedAt,
    dispute:
      d.dispute && d.dispute.status && d.dispute.status !== 'none'
        ? { status: d.dispute.status, reason: d.dispute.reason, message: d.dispute.message, response: d.dispute.response, openedAt: d.dispute.openedAt, handledAt: d.dispute.handledAt }
        : null,
    campaign: {
      _id: d.campaign._id,
      title: d.campaign.title,
      patientName: d.campaign.patientName,
      hospital: d.campaign.hospital && d.campaign.hospital.name,
    },
  });
}));

router.post('/campaigns', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const user = req.user;

  const title = text(b.title, 120);
  if (title.length < 5) return res.status(400).json({ error: 'The title must be at least 5 characters' });

  const patientName = text(b.patientName, 80);
  if (patientName.length < 2) return res.status(400).json({ error: "Enter the patient's name" });

  const story = longText(b.story, 5000);
  if (story.length < 50) return res.status(400).json({ error: 'Tell the story in at least 50 characters' });

  const hospitalName = text(b.hospital && b.hospital.name, 120);
  if (hospitalName.length < 3) return res.status(400).json({ error: 'Enter the hospital name' });

  const loc = b.location || {};
  const division = text(loc.division, 50);
  const district = text(loc.district, 50);
  if (!division || !district) return res.status(400).json({ error: 'Choose a division and a district' });

  const target = readWhole(b.targetAmount, LIMITS.minTarget, LIMITS.maxTarget);
  if (target === null) return res.status(400).json({ error: 'The target must be from ৳500 to ৳1,00,00,000' });

  const photos = Array.isArray(b.photos) ? b.photos.map((p) => text(p, 500)).filter(Boolean) : [];
  if (photos.length > 3) return res.status(400).json({ error: 'You can add up to 3 photos' });
  if (photos.some((p) => !PUBLIC_IMAGE_RE.test(p))) return res.status(400).json({ error: 'One of the photo links is not valid' });

  const documents = Array.isArray(b.documents) ? b.documents.map((d) => text(d, 100)).filter(Boolean) : [];
  if (documents.length < 1 || documents.length > 3) {
    return res.status(400).json({ error: 'Add 1 to 3 photos of documents that prove the need, like a prescription or hospital letter' });
  }
  const docIds = documents.map((d) => (PRIVATE_IMAGE_RE.exec(d) || [])[1]);
  if (docIds.some((id) => !id)) return res.status(400).json({ error: 'One of the documents is not valid' });

  const uniqueDocIds = [...new Set(docIds)];
  const ownedDocs = await Image.countDocuments({ _id: { $in: uniqueDocIds }, isPrivate: true, uploadedBy: user._id });
  if (ownedDocs !== uniqueDocIds.length) return res.status(400).json({ error: 'Please upload your documents again' });

  const rawAccounts = Array.isArray(b.paymentAccounts) ? b.paymentAccounts : [];
  if (rawAccounts.length < 1 || rawAccounts.length > 4) {
    return res.status(400).json({ error: 'Add 1 to 4 payment accounts' });
  }
  const accounts = [];
  for (const raw of rawAccounts) {
    const result = readAccount(raw);
    if (result.error) return res.status(400).json({ error: result.error });
    accounts.push(result.account);
  }
  if (new Set(accounts.map((a) => a.method)).size !== accounts.length) {
    return res.status(400).json({ error: 'Use each payment method only once' });
  }

  const open = await Campaign.countDocuments({ owner: user._id, status: { $in: ['pending', 'active'] } });
  if (open >= 2) {
    return res.status(429).json({ error: 'You already have 2 open campaigns. Close one before starting another.' });
  }

  const campaign = await Campaign.create({
    owner: user._id,
    ownerName: user.name,
    title,
    story,
    patientName,
    hospital: { name: hospitalName, address: text(b.hospital && b.hospital.address, 200) },
    location: { division, district, area: text(loc.area, 50) },
    targetAmount: target,
    photos,
    documents: uniqueDocIds.map((id) => `/api/private-images/${id}`),
    paymentAccounts: accounts,
  });

  res.status(201).json({ id: campaign._id, status: campaign.status });
}));

router.get('/campaigns/:id', optionalAuth, wrap(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });
  if (!VISIBLE.includes(campaign.status) && !canManage(campaign, req.user)) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json(shapeCampaign(campaign, req.user, true));
}));

router.get('/campaigns/:id/donors', wrap(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id).select('status');
  if (!campaign || !VISIBLE.includes(campaign.status)) return res.status(404).json({ error: 'Not found' });

  const rows = await Donation.find({ campaign: campaign._id, status: 'confirmed' })
    .sort({ confirmedAt: -1 })
    .limit(100)
    .lean();

  res.json(
    rows.map((d) => ({
      _id: d._id,
      name: d.isAnonymous ? 'Anonymous' : d.donorName || 'Anonymous',
      isAnonymous: d.isAnonymous || !d.donorName,
      amount: d.amount,
      method: d.method,
      at: d.confirmedAt,
    }))
  );
}));

router.get('/campaigns/:id/expenses', wrap(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id).select('status');
  if (!campaign || !VISIBLE.includes(campaign.status)) return res.status(404).json({ error: 'Not found' });

  const rows = await Expense.find({ campaign: campaign._id })
    .sort({ spentOn: -1, _id: -1 })
    .limit(100)
    .select('title amount spentOn proofUrl')
    .lean();
  res.json(rows);
}));

router.post('/campaigns/:id/donations', optionalAuth, wrap(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });
  if (campaign.status !== 'active') {
    return res.status(400).json({ error: 'This campaign is not taking donations now' });
  }

  const b = req.body || {};

  const method = text(b.method, 10);
  if (!campaign.paymentAccounts.some((a) => a.method === method)) {
    return res.status(400).json({ error: 'This campaign does not accept that payment method' });
  }

  const amount = readWhole(b.amount, LIMITS.minDonation, LIMITS.maxDonation);
  if (amount === null) return res.status(400).json({ error: 'Enter an amount from ৳10 to ৳50,00,000' });

  const trxId = readTrxId(b.trxId);
  if (!trxId) return res.status(400).json({ error: 'Enter the transaction ID from your payment message' });

  const donorEmail = text(b.donorEmail, 120).toLowerCase();
  if (donorEmail && !EMAIL_RE.test(donorEmail)) return res.status(400).json({ error: 'Enter a valid email address' });

  const phoneRaw = text(b.donorPhone, 20);
  const donorPhone = phoneRaw ? normalizeBdNumber(phoneRaw) : '';
  if (phoneRaw && !donorPhone) return res.status(400).json({ error: 'Enter a valid Bangladeshi mobile number' });

  const donorName = text(b.donorName, 60) || (req.user ? req.user.name : '');

  const hash = ipHash(req.ip);
  const recent = await Donation.countDocuments({
    ipHash: hash,
    status: 'pending',
    createdAt: { $gte: new Date(Date.now() - HOUR) },
  });
  if (recent >= 5) {
    return res.status(429).json({ error: 'Too many donations waiting for confirmation. Please try again later.' });
  }

  if (await Donation.exists({ method, trxId })) {
    return res.status(409).json({ error: 'This transaction ID was already submitted' });
  }

  let donation;
  try {
    donation = await Donation.create({
      campaign: campaign._id,
      donor: req.user ? req.user._id : undefined,
      donorName,
      isAnonymous: b.isAnonymous === true,
      donorPhone: donorPhone || undefined,
      donorEmail: donorEmail || undefined,
      amount,
      method,
      trxId,
      receiptNo: receiptNumber(),
      ipHash: hash,
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'This transaction ID was already submitted' });
    throw err;
  }

  try {
    await notifyOwnerOfDonation(campaign, donation);
  } catch (err) {
    console.error('owner email failed:', err.message);
  }

  res.status(201).json({ receiptNo: donation.receiptNo, status: donation.status });
}));

router.get('/campaigns/:id/manage', requireAuth, wrap(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });
  if (!canManage(campaign, req.user)) return res.status(403).json({ error: 'You cannot manage this campaign' });

  const rows = await Donation.find({ campaign: campaign._id }).sort({ createdAt: -1 }).limit(200).lean();

  res.json(
    rows.map((d) => ({
      _id: d._id,
      donorName: d.donorName,
      isAnonymous: d.isAnonymous,
      donorPhone: d.donorPhone,
      donorEmail: d.donorEmail,
      amount: d.amount,
      method: d.method,
      trxId: d.trxId,
      receiptNo: d.receiptNo,
      status: d.status,
      rejectionReason: d.rejectionReason,
      createdAt: d.createdAt,
      confirmedAt: d.confirmedAt,
      byOwner: Boolean(d.donor) && String(d.donor) === String(campaign.owner),
            dispute:
        d.dispute && d.dispute.status && d.dispute.status !== 'none'
          ? { status: d.dispute.status, reason: d.dispute.reason, message: d.dispute.message, openedAt: d.dispute.openedAt, response: d.dispute.response }
          : undefined,
    }))
  );
}));

router.patch('/donations/:donationId/confirm', requireAuth, wrap(async (req, res) => {
  const donation = await Donation.findById(req.params.donationId);
  if (!donation) return res.status(404).json({ error: 'Not found' });

  const campaign = await Campaign.findById(donation.campaign);
  if (!campaign || !canManage(campaign, req.user)) return res.status(403).json({ error: 'You cannot manage this campaign' });
  if (!VISIBLE.includes(campaign.status)) return res.status(400).json({ error: 'This campaign is not open' });
  if (donation.status !== 'pending') return res.status(400).json({ error: 'This donation was already decided' });

  if (donation.donor && String(donation.donor) === String(campaign.owner) && !isAdminUser(req.user)) {
    return res.status(403).json({ error: 'A donation made by the campaign owner must be confirmed by an admin' });
  }

  donation.status = 'confirmed';
  donation.confirmedAt = new Date();
  donation.confirmedBy = req.user._id;
  await donation.save();

  const updated = await recompute(campaign._id);

  if (isAdminUser(req.user)) {
    await logAction(req.user, 'donation.confirm', 'Donation', donation._id, `${donation.amount} to ${campaign.title}`);
  }

  try {
    await sendReceiptEmail(updated || campaign, donation);
  } catch (err) {
    console.error('receipt email failed:', err.message);
  }

    try {
    await withTimeout(pushDonationConfirmed(updated || campaign, donation), 3000);
  } catch (err) {
    console.error('donation push failed:', err.message);
  }

  res.json({ ok: true, raised: updated ? updated.raised : undefined, status: updated ? updated.status : undefined });
}));

router.patch('/donations/:donationId/reject', requireAuth, wrap(async (req, res) => {
  const donation = await Donation.findById(req.params.donationId);
  if (!donation) return res.status(404).json({ error: 'Not found' });

  const campaign = await Campaign.findById(donation.campaign);
  if (!campaign || !canManage(campaign, req.user)) return res.status(403).json({ error: 'You cannot manage this campaign' });
  if (donation.status !== 'pending') return res.status(400).json({ error: 'This donation was already decided' });

  donation.status = 'rejected';
  donation.rejectionReason = text(req.body && req.body.reason, 200) || 'The payment was not found';
  await donation.save();

  if (isAdminUser(req.user)) {
    await logAction(req.user, 'donation.reject', 'Donation', donation._id, `${donation.amount} to ${campaign.title}`);
  }

  res.json({ ok: true });
}));

router.post('/campaigns/:id/expenses', requireAuth, wrap(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });
  if (!canManage(campaign, req.user)) return res.status(403).json({ error: 'You cannot manage this campaign' });
  if (!VISIBLE.includes(campaign.status)) return res.status(400).json({ error: 'This campaign is not open' });

  const b = req.body || {};

  const title = text(b.title, 120);
  if (title.length < 3) return res.status(400).json({ error: 'Write what the money was spent on' });

  const amount = readWhole(b.amount, 1, LIMITS.maxDonation);
  if (amount === null) return res.status(400).json({ error: 'Enter the amount spent' });

  const spentOn = new Date(b.spentOn);
  if (Number.isNaN(spentOn.getTime()) || spentOn.getTime() > Date.now() + 24 * HOUR) {
    return res.status(400).json({ error: 'Enter a valid date' });
  }

  const proofUrl = text(b.proofUrl, 500);
  if (!PUBLIC_IMAGE_RE.test(proofUrl)) return res.status(400).json({ error: 'Add a photo of the receipt or bill' });

  if (campaign.spent + amount > campaign.raised) {
    return res.status(400).json({
      error: `You cannot spend more than the money received (৳${campaign.raised.toLocaleString('en-IN')}). ৳${Math.max(0, campaign.raised - campaign.spent).toLocaleString('en-IN')} is left.`,
    });
  }

  const expense = await Expense.create({
    campaign: campaign._id,
    title,
    amount,
    spentOn,
    proofUrl,
    addedBy: req.user._id,
  });
  await recompute(campaign._id);

    try {
    await withTimeout(pushExpenseAdded(campaign, expense), 3000);
  } catch (err) {
    console.error('expense push failed:', err.message);
  }

  res.status(201).json({ id: expense._id });
}));

router.delete('/expenses/:expenseId', requireAuth, wrap(async (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ error: 'Only an admin can remove an expense' });

  const expense = await Expense.findByIdAndDelete(req.params.expenseId);
  if (!expense) return res.status(404).json({ error: 'Not found' });

  await recompute(expense.campaign);
  await logAction(req.user, 'expense.delete', 'Expense', expense._id, `${expense.amount}: ${expense.title}`);
  res.json({ ok: true });
}));

router.patch('/campaigns/:id/close', requireAuth, wrap(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });
  if (!canManage(campaign, req.user)) return res.status(403).json({ error: 'You cannot manage this campaign' });
  if (!['active', 'completed'].includes(campaign.status)) return res.status(400).json({ error: 'This campaign is not open' });

  campaign.status = 'closed';
  await campaign.save();

  if (isAdminUser(req.user)) await logAction(req.user, 'campaign.close', 'Campaign', campaign._id, campaign.title);
  res.json({ ok: true });
}));

router.post('/campaigns/:id/flag', wrap(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign || !LISTED.includes(campaign.status)) return res.status(404).json({ error: 'Not found' });

  const hash = ipHash(req.ip);
  if (campaign.flags.some((f) => f.ipHash === hash)) {
    return res.status(409).json({ error: 'You have already reported this campaign' });
  }

  if (campaign.flags.length < 50) {
    campaign.flags.push({ ipHash: hash, reason: text(req.body && req.body.reason, 200) });
    await campaign.save();
  }
  res.json({ ok: true });
}));

router.post('/receipts/:receiptNo/dispute', wrap(async (req, res) => {
  const no = text(req.params.receiptNo, 30).toUpperCase();
  if (!/^DON-[A-F0-9]{12}$/.test(no)) return res.status(404).json({ error: 'Not found' });

  const donation = await Donation.findOne({ receiptNo: no });
  if (!donation) return res.status(404).json({ error: 'Not found' });
  if (donation.status === 'refunded') return res.status(400).json({ error: 'This donation was already refunded' });
  if (donation.dispute && donation.dispute.status === 'open') {
    return res.status(409).json({ error: 'You already have an open complaint for this donation' });
  }

  const b = req.body || {};
  const reason = ['not_confirmed', 'wrong_amount', 'refund', 'other'].includes(b.reason) ? b.reason : 'other';
  const message = text(b.message, 500);
  if (message.length < 10) return res.status(400).json({ error: 'Tell us what went wrong, in at least 10 characters' });

  donation.dispute = { status: 'open', reason, message, openedAt: new Date() };
  await donation.save();

  res.json({ ok: true });
}));

router.patch('/donations/:donationId/dispute', requireAuth, wrap(async (req, res) => {
  const donation = await Donation.findById(req.params.donationId);
  if (!donation) return res.status(404).json({ error: 'Not found' });

  const campaign = await Campaign.findById(donation.campaign);
  if (!campaign || !canManage(campaign, req.user)) return res.status(403).json({ error: 'You cannot manage this campaign' });
  if (!donation.dispute || donation.dispute.status !== 'open') {
    return res.status(400).json({ error: 'There is no open complaint for this donation' });
  }

  const b = req.body || {};
  const action = text(b.action, 10);
  const response = text(b.response, 500);
  if (!['confirm', 'refund', 'resolve'].includes(action)) return res.status(400).json({ error: 'Choose what to do' });
  if (response.length < 3) return res.status(400).json({ error: 'Write a short answer for the donor' });

  const wasConfirmed = donation.status === 'confirmed';

  if (action === 'refund') {
    const ref = text(b.refundRef, 60);
    if (ref.length < 4) return res.status(400).json({ error: 'Enter the transaction ID or a note of the money you sent back' });
    if (wasConfirmed && campaign.spent > campaign.raised - donation.amount) {
      return res.status(400).json({
        error: `This money was already spent on bills (৳${campaign.spent.toLocaleString('en-IN')}), so a refund would break the ledger. Ask an admin for help.`,
      });
    }

    donation.status = 'refunded';
    donation.dispute.status = 'refunded';
    donation.dispute.refundRef = ref;
  } else if (action === 'confirm') {
    if (!VISIBLE.includes(campaign.status)) return res.status(400).json({ error: 'This campaign is not open' });
    if (donation.status === 'refunded') return res.status(400).json({ error: 'This donation was refunded' });
    if (donation.donor && String(donation.donor) === String(campaign.owner) && !isAdminUser(req.user)) {
      return res.status(403).json({ error: 'A donation made by the campaign owner must be confirmed by an admin' });
    }

    donation.status = 'confirmed';
    donation.confirmedAt = new Date();
    donation.confirmedBy = req.user._id;
    donation.dispute.status = 'resolved';
  } else {
    donation.dispute.status = 'resolved';
  }

  donation.dispute.response = response;
  donation.dispute.handledAt = new Date();
  donation.dispute.handledBy = req.user._id;
  await donation.save();

  let updated = null;
  if (wasConfirmed || action === 'confirm') updated = await recompute(campaign._id);

  if (action === 'confirm') {
    try {
      await sendReceiptEmail(updated || campaign, donation);
      await withTimeout(pushDonationConfirmed(updated || campaign, donation), 3000);
    } catch (err) {
      console.error('confirm notice failed:', err.message);
    }
  }

  if (isAdminUser(req.user)) {
    await logAction(req.user, `dispute.${action}`, 'Donation', donation._id, `${donation.amount} to ${campaign.title}`);
  }

  res.json({ ok: true });
}));

module.exports = router;