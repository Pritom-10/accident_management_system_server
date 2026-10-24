const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const User = require('../models/User');
const BloodRequest = require('../models/BloodRequest');
const { withTimeout } = require('../utils/push');
const { pushBlood, pushOffer } = require('../utils/pushNotify');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { normalizeBdNumber } = require('../utils/phone');
const {
  BLOOD_GROUPS,
  donorsFor,
  recipientsFor,
  checkEligibility,
  eligibleDonorQuery,
} = require('../utils/blood');
const { notifyDonorsByEmail, notifyRequesterOfOffer } = require('../utils/bloodNotify');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const OPEN = ['pending', 'accepted'];
const MAX_OPEN_PER_USER = 3;

const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => res.status(500).json({ error: err.message }));

function checkObjectId(req, res, next, id) {
  if (!mongoose.isValidObjectId(id)) return res.status(404).json({ error: 'Not found' });
  next();
}
router.param('id', checkObjectId);
router.param('donorId', checkObjectId);

const openFilter = (now = new Date()) => ({
  status: { $in: OPEN },
  neededBy: { $gte: new Date(now.getTime() - 3 * HOUR) },
});

const isAdminUser = (u) => Boolean(u && u.roles.includes('admin'));
const isOwnerOf = (r, u) => Boolean(u && String(r.requester) === String(u._id));

function shape(request, viewer) {
  const o = request.toObject ? request.toObject() : request;
  const live = (o.responses || []).filter((x) => x.status !== 'withdrawn');
  const owner = isOwnerOf(o, viewer);
  const admin = isAdminUser(viewer);
  const privileged = owner || admin || Boolean(viewer && viewer.donor && viewer.donor.isDonor);
  const mine = viewer ? live.find((x) => String(x.donor) === String(viewer._id)) : null;

  const out = {
    _id: o._id,
    patientName: privileged ? o.patientName : String(o.patientName).split(' ')[0],
    bloodGroup: o.bloodGroup,
    unitsNeeded: o.unitsNeeded,
    unitsDonated: o.unitsDonated,
    hospital: o.hospital,
    location: o.location,
    neededBy: o.neededBy,
    note: o.note,
    status: o.status,
    requesterName: o.requesterName,
    createdAt: o.createdAt,
    offers: live.length,
    isOwner: owner,
    myOffer: mine ? { status: mine.status } : null,
  };

  if (privileged) out.contactPhone = o.contactPhone;
  if (o.status === 'cancelled') out.cancelledReason = o.cancelledReason;
  if (owner || admin) {
    out.responses = live.map((x) => ({
      donor: x.donor,
      donorName: x.donorName,
      donorPhone: x.donorPhone,
      donorGroup: x.donorGroup,
      status: x.status,
      at: x.at,
    }));
  }
  return out;
}

router.get('/stats', wrap(async (req, res) => {
  const [openRequests, donors, totals] = await Promise.all([
    BloodRequest.countDocuments(openFilter()),
    User.countDocuments(eligibleDonorQuery()),
    User.aggregate([{ $group: { _id: null, total: { $sum: '$donor.donationCount' } } }]),
  ]);
  res.json({ openRequests, donors, donations: totals[0] ? totals[0].total : 0 });
}));

router.get('/requests', wrap(async (req, res) => {
  const filter = openFilter();
  const group = str(req.query.group, 3);
  if (BLOOD_GROUPS.includes(group)) filter.bloodGroup = group;

  const division = str(req.query.division, 50);
  const district = str(req.query.district, 50);
  const area = str(req.query.area, 50);
  if (division) filter['location.division'] = division;
  if (district) filter['location.district'] = district;
  if (area) filter['location.area'] = area;

  const limit = Math.min(24, Math.max(1, parseInt(req.query.limit, 10) || 9));
  const page = Math.min(1000, Math.max(1, parseInt(req.query.page, 10) || 1));

  const [total, items] = await Promise.all([
    BloodRequest.countDocuments(filter),
    BloodRequest.find(filter)
      .sort({ neededBy: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  res.json({
    items: items.map((r) => shape(r, null)),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
}));

router.get('/requests/:id', optionalAuth, wrap(async (req, res) => {
  const request = await BloodRequest.findById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Not found' });

  const viewer = req.user;
  if (request.status === 'cancelled' && !isOwnerOf(request, viewer) && !isAdminUser(viewer)) {
    return res.status(404).json({ error: 'This request is no longer available' });
  }
  res.json(shape(request, viewer));
}));

router.post('/requests', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const user = req.user;

  const group = str(b.bloodGroup, 3);
  if (!BLOOD_GROUPS.includes(group)) return res.status(400).json({ error: 'Choose the blood group' });

  const patientName = str(b.patientName, 80);
  if (patientName.length < 2) return res.status(400).json({ error: "Enter the patient's name" });

  const units = Number(b.unitsNeeded);
  if (!Number.isInteger(units) || units < 1 || units > 10) {
    return res.status(400).json({ error: 'Units needed must be from 1 to 10' });
  }

  const hospitalName = str(b.hospital && b.hospital.name, 120);
  if (hospitalName.length < 3) return res.status(400).json({ error: 'Enter the hospital name' });

  const loc = b.location || {};
  const division = str(loc.division, 50);
  const district = str(loc.district, 50);
  if (!division || !district) return res.status(400).json({ error: 'Choose a division and a district' });

  const neededBy = new Date(b.neededBy);
  const now = new Date();
  if (Number.isNaN(neededBy.getTime())) return res.status(400).json({ error: 'Enter when the blood is needed' });
  if (neededBy.getTime() < now.getTime() - HOUR) return res.status(400).json({ error: 'The time has already passed' });
  if (neededBy.getTime() > now.getTime() + 30 * DAY) return res.status(400).json({ error: 'Choose a date within 30 days' });

  const phone = normalizeBdNumber(b.contactPhone);
  if (!phone) return res.status(400).json({ error: 'Enter a valid Bangladeshi mobile number, like 01712345678' });

  const openCount = await BloodRequest.countDocuments({ requester: user._id, ...openFilter(now) });
  if (openCount >= MAX_OPEN_PER_USER) {
    return res.status(429).json({ error: `You already have ${MAX_OPEN_PER_USER} open requests. Close one before adding another.` });
  }

  const request = await BloodRequest.create({
    requester: user._id,
    requesterName: user.name,
    patientName,
    bloodGroup: group,
    unitsNeeded: units,
    hospital: { name: hospitalName, address: str(b.hospital && b.hospital.address, 200) },
    location: { division, district, area: str(loc.area, 50) },
    neededBy,
    contactPhone: phone,
    note: str(b.note, 300),
  });

   const [mail, push] = await Promise.allSettled([
    withTimeout(notifyDonorsByEmail(request), 4000),
    withTimeout(pushBlood(request), 4000),
  ]);
  const emailed = mail.status === 'fulfilled' ? mail.value || 0 : 0;
  const pushed = push.status === 'fulfilled' ? push.value || 0 : 0;

  res.status(201).json({ id: request._id, emailed, pushed });
}));

router.patch('/requests/:id/cancel', requireAuth, wrap(async (req, res) => {
  const request = await BloodRequest.findById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Not found' });
  if (!isOwnerOf(request, req.user) && !isAdminUser(req.user)) {
    return res.status(403).json({ error: 'Only the person who made the request can cancel it' });
  }
  if (!OPEN.includes(request.status)) return res.status(400).json({ error: 'This request is already closed' });

  request.status = 'cancelled';
  request.cancelledReason = str(req.body && req.body.reason, 200);
  await request.save();
  res.json({ ok: true });
}));

router.post('/requests/:id/offer', requireAuth, wrap(async (req, res) => {
  const user = req.user;
  const request = await BloodRequest.findById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Not found' });

  if (isOwnerOf(request, user)) return res.status(400).json({ error: 'You cannot offer on your own request' });
  if (!OPEN.includes(request.status) || request.neededBy.getTime() < Date.now() - 3 * HOUR) {
    return res.status(400).json({ error: 'This request is closed' });
  }
  if (!user.donor || !user.donor.isDonor) return res.status(403).json({ error: 'Register as a donor first' });
  if (user.donor.availability !== 'available') {
    return res.status(400).json({ error: 'Turn on your availability on the donor page first' });
  }

  const check = checkEligibility(user.donor);
  if (!check.eligible) return res.status(400).json({ error: check.reasons[0] });

  if (!user.bloodGroup || !donorsFor(request.bloodGroup).includes(user.bloodGroup)) {
    return res.status(400).json({ error: 'Your blood group cannot be given to this patient' });
  }

  const existing = request.responses.find((r) => String(r.donor) === String(user._id));
  if (existing && existing.status !== 'withdrawn') {
    return res.status(409).json({ error: 'You have already offered to donate' });
  }

  if (existing) {
    existing.status = 'offered';
    existing.at = new Date();
    existing.donorPhone = user.donor.contactPhone;
  } else {
    request.responses.push({
      donor: user._id,
      donorName: user.name,
      donorPhone: user.donor.contactPhone,
      donorGroup: user.bloodGroup,
    });
  }

  request.refreshStatus();
  await request.save();

   await Promise.allSettled([
    withTimeout(notifyRequesterOfOffer(request, user), 4000),
    withTimeout(pushOffer(request, user), 4000),
  ]);

  res.json({ ok: true, status: request.status });
}));

router.delete('/requests/:id/offer', requireAuth, wrap(async (req, res) => {
  const request = await BloodRequest.findById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Not found' });

  const response = request.responses.find((r) => String(r.donor) === String(req.user._id));
  if (!response || response.status === 'withdrawn') return res.status(400).json({ error: 'You have no offer here' });
  if (response.status === 'donated') return res.status(400).json({ error: 'Your donation is already confirmed' });

  response.status = 'withdrawn';
  request.refreshStatus();
  await request.save();
  res.json({ ok: true });
}));

router.patch('/requests/:id/responses/:donorId/donated', requireAuth, wrap(async (req, res) => {
  const request = await BloodRequest.findById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Not found' });
  if (!isOwnerOf(request, req.user) && !isAdminUser(req.user)) {
    return res.status(403).json({ error: 'Only the person who made the request can confirm a donation' });
  }
  if (request.status === 'cancelled') return res.status(400).json({ error: 'This request is cancelled' });

  const response = request.responses.find((r) => String(r.donor) === req.params.donorId);
  if (!response || response.status !== 'offered') {
    return res.status(400).json({ error: 'There is no active offer from this donor' });
  }

  response.status = 'donated';
  request.refreshStatus();
  await request.save();

  await User.updateOne(
    { _id: response.donor },
    { $set: { 'donor.lastDonationDate': new Date() }, $inc: { 'donor.donationCount': 1 } }
  );

  res.json({ ok: true, status: request.status });
}));

router.get('/mine', requireAuth, wrap(async (req, res) => {
  const user = req.user;
  const [requests, offers] = await Promise.all([
    BloodRequest.find({ requester: user._id }).sort({ createdAt: -1 }).limit(50),
    BloodRequest.find({ 'responses.donor': user._id }).sort({ createdAt: -1 }).limit(50),
  ]);

  res.json({
    requests: requests.map((r) => shape(r, user)),
    offers: offers.map((r) => shape(r, user)).filter((r) => r.myOffer),
  });
}));

router.get('/feed', requireAuth, wrap(async (req, res) => {
  const user = req.user;
  const isDonor = Boolean(user.donor && user.donor.isDonor);
  if (!isDonor || !user.bloodGroup) return res.json({ items: [], isDonor });

  const filter = {
    ...openFilter(),
    bloodGroup: { $in: recipientsFor(user.bloodGroup) },
    requester: { $ne: user._id },
  };
  if (user.address && user.address.district) filter['location.district'] = user.address.district;

  const items = await BloodRequest.find(filter).sort({ neededBy: 1 }).limit(30);
  res.json({ items: items.map((r) => shape(r, user)), isDonor });
}));

router.get('/donors', requireAuth, wrap(async (req, res) => {
  const filter = { ...eligibleDonorQuery(), _id: { $ne: req.user._id } };

  const group = str(req.query.group, 3);
  if (BLOOD_GROUPS.includes(group)) {
    filter.bloodGroup = req.query.compatible === '1' ? { $in: donorsFor(group) } : group;
  }

  const division = str(req.query.division, 50);
  const district = str(req.query.district, 50);
  const area = str(req.query.area, 50);
  if (division) filter['address.division'] = division;
  if (district) filter['address.district'] = district;
  if (area) filter['address.area'] = area;

  const limit = Math.min(24, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const page = Math.min(1000, Math.max(1, parseInt(req.query.page, 10) || 1));

  const [total, users] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter)
      .select('name photoUrl bloodGroup address donor.contactPhone donor.lastDonationDate donor.donationCount')
      .sort({ 'donor.lastDonationDate': 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  res.json({
    items: users.map((u) => ({
      _id: u._id,
      name: u.name,
      photoUrl: u.photoUrl,
      bloodGroup: u.bloodGroup,
      division: u.address && u.address.division,
      district: u.address && u.address.district,
      area: u.address && u.address.area,
      phone: u.donor && u.donor.contactPhone,
      lastDonationDate: u.donor && u.donor.lastDonationDate,
      donationCount: (u.donor && u.donor.donationCount) || 0,
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
}));

router.put('/donor', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const user = req.user;

  const group = str(b.bloodGroup, 3);
  if (!BLOOD_GROUPS.includes(group)) return res.status(400).json({ error: 'Choose your blood group' });

  const dob = new Date(b.dateOfBirth);
  if (!b.dateOfBirth || Number.isNaN(dob.getTime()) || dob > new Date() || dob.getFullYear() < 1900) {
    return res.status(400).json({ error: 'Enter a valid date of birth' });
  }

  const weight = Number(b.weightKg);
  if (!Number.isFinite(weight) || weight < 30 || weight > 250) {
    return res.status(400).json({ error: 'Enter your weight in kg' });
  }

  let last;
  if (b.lastDonationDate) {
    last = new Date(b.lastDonationDate);
    if (Number.isNaN(last.getTime()) || last > new Date()) {
      return res.status(400).json({ error: 'Enter a valid date for your last donation' });
    }
  }

  const phone = normalizeBdNumber(b.contactPhone);
  if (!phone) return res.status(400).json({ error: 'Enter a valid Bangladeshi mobile number, like 01712345678' });

  const a = b.address || {};
  const division = str(a.division, 50);
  const district = str(a.district, 50);
  if (!division || !district) return res.status(400).json({ error: 'Choose your division and district' });

  if (b.showContact !== true) {
    return res.status(400).json({ error: 'Please agree to share your contact number with people who need blood' });
  }

  const previous = user.donor || {};
  const availability = ['available', 'unavailable'].includes(b.availability)
    ? b.availability
    : previous.availability || 'available';

  user.bloodGroup = group;
  user.address = { division, district, area: str(a.area, 50), details: (user.address && user.address.details) || '' };
  user.donor = {
    isDonor: true,
    dateOfBirth: dob,
    weightKg: weight,
    lastDonationDate: last,
    availability,
    contactPhone: phone,
    showContact: true,
    emailAlerts: b.emailAlerts !== false,
    donationCount: previous.donationCount || 0,
    registeredAt: previous.registeredAt || new Date(),
  };
  if (!user.roles.includes('donor')) user.roles.push('donor');

  await user.save();
  res.json({ user: user.toPublic(), eligibility: checkEligibility(user.donor) });
}));

router.patch('/donor/availability', requireAuth, wrap(async (req, res) => {
  const user = req.user;
  if (!user.donor || !user.donor.isDonor) return res.status(400).json({ error: 'Register as a donor first' });

  const value = req.body && req.body.availability;
  if (!['available', 'unavailable'].includes(value)) return res.status(400).json({ error: 'Invalid value' });

  user.donor.availability = value;
  await user.save();
  res.json({ user: user.toPublic() });
}));

router.delete('/donor', requireAuth, wrap(async (req, res) => {
  const user = req.user;
  if (user.donor) {
    user.donor.isDonor = false;
    user.donor.availability = 'unavailable';
  }
  user.roles = user.roles.filter((r) => r !== 'donor');
  await user.save();
  res.json({ user: user.toPublic() });
}));

module.exports = router;