const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const User = require('../models/User');
const AccidentReport = require('../models/AccidentReport');
const UnidentifiedPatient = require('../models/UnidentifiedPatient');
const BlockedPhone = require('../models/BlockedPhone');
const AuditLog = require('../models/AuditLog');
const { requireAuth, requireRole } = require('../middleware/auth');
const { normalizeBdNumber } = require('../utils/phone');
const { logAction } = require('../utils/audit');


router.use(requireAuth, requireRole('admin'));


router.param('id', (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) return res.status(404).json({ error: 'Not found' });
  next();
});

const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phoneKey = (p) => normalizeBdNumber(p) || String(p || '').replace(/\D/g, '');
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => res.status(500).json({ error: err.message }));

const PUBLIC_STATUSES = ['verified', 'rescue_in_progress', 'cleared'];
const ASSIGNABLE_ROLES = ['donor', 'volunteer', 'hospital', 'bloodbank', 'ngo', 'journalist', 'admin'];



router.get('/stats', wrap(async (req, res) => {
  const [pendingReports, pendingVolunteers, pendingPatients, users] = await Promise.all([
    AccidentReport.countDocuments({ status: 'pending' }),
    User.countDocuments({ 'volunteer.status': 'pending' }),
    UnidentifiedPatient.countDocuments({ status: 'pending' }),
    User.countDocuments(),
  ]);
  res.json({ pendingReports, pendingVolunteers, pendingPatients, users });
}));



const REPORT_FILTERS = {
  pending: ['pending'],
  verified: PUBLIC_STATUSES,
  rejected: ['rejected'],
};

router.get('/reports', wrap(async (req, res) => {
  const statuses = REPORT_FILTERS[req.query.status] || REPORT_FILTERS.pending;
  const reports = await AccidentReport.find({ status: { $in: statuses } })
    .sort({ createdAt: -1 })
    .limit(200);
  res.json(reports);
}));


router.patch('/reports/:id/status', wrap(async (req, res) => {
  const status = req.body?.status;
  if (!['rescue_in_progress', 'cleared'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const report = await AccidentReport.findById(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });

  const wasPublic = PUBLIC_STATUSES.includes(report.status);
  report.status = status;
  report.rejectionReason = undefined;
  if (!wasPublic) {
    report.verifiedBy = req.user._id;
    report.verifiedAt = new Date();
  }
  await report.save();

  await logAction(req.user, wasPublic ? 'report.status' : 'report.approve', 'AccidentReport', report.caseId, status);
  res.json(report);
}));


router.patch('/reports/:id/reject', wrap(async (req, res) => {
  const { reason, fake, blockPhone } = req.body || {};

  const report = await AccidentReport.findById(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });

  report.status = 'rejected';
  report.rejectionReason = str(reason) || (fake === true ? 'Fake information' : 'Rejected by admin');
  await report.save();

  let blocked = false;
  if (blockPhone === true) {
    const key = phoneKey(report.reporterPhone);
    if (key) {
      await BlockedPhone.updateOne(
        { phone: key },
        { $setOnInsert: { reason: report.rejectionReason, blockedBy: req.user._id } },
        { upsert: true }
      );
      blocked = true;
    }
  }

  await logAction(
    req.user,
    fake === true ? 'report.fake' : 'report.reject',
    'AccidentReport',
    report.caseId,
    `${report.rejectionReason}${blocked ? ' (number blocked)' : ''}`
  );
  res.json({ ok: true, blocked });
}));



router.get('/volunteers', wrap(async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const list = await User.find({ 'volunteer.status': status })
    .select('-passwordHash -reset')
    .sort({ updatedAt: -1 })
    .limit(200);
  res.json(list);
}));

router.patch('/volunteers/:id/approve', wrap(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });

  if (!user.roles.includes('volunteer')) user.roles.push('volunteer');
  user.volunteer.status = 'approved';
  user.volunteer.rejectionReason = undefined;
  await user.save();

  await logAction(req.user, 'volunteer.approve', 'User', user._id, user.name);
  res.json({ ok: true });
}));


router.patch('/volunteers/:id/reject', wrap(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });

  user.roles = user.roles.filter((r) => r !== 'volunteer');
  user.volunteer.status = 'rejected';
  user.volunteer.rejectionReason = str(req.body?.reason) || 'Not approved';
  user.volunteer.availability = 'unavailable';
  await user.save();

  await logAction(req.user, 'volunteer.reject', 'User', user._id, `${user.name}: ${user.volunteer.rejectionReason}`);
  res.json({ ok: true });
}));



router.get('/patients', wrap(async (req, res) => {
  const status = ['pending', 'verified', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const list = await UnidentifiedPatient.find({ status })
    .populate('admittingHospital', 'name')
    .sort({ createdAt: -1 })
    .limit(200);
  res.json(list);
}));

router.patch('/patients/:id/verify', wrap(async (req, res) => {
  const patient = await UnidentifiedPatient.findByIdAndUpdate(
    req.params.id,
    { status: 'verified', verifiedBy: req.user._id },
    { new: true }
  );
  if (!patient) return res.status(404).json({ error: 'Not found' });

  await logAction(req.user, 'patient.verify', 'UnidentifiedPatient', patient._id);
  res.json({ ok: true });
}));

router.patch('/patients/:id/reject', wrap(async (req, res) => {
  const patient = await UnidentifiedPatient.findByIdAndUpdate(
    req.params.id,
    { status: 'rejected', verifiedBy: req.user._id },
    { new: true }
  );
  if (!patient) return res.status(404).json({ error: 'Not found' });

  await logAction(req.user, 'patient.reject', 'UnidentifiedPatient', patient._id);
  res.json({ ok: true });
}));



router.get('/users', wrap(async (req, res) => {
  const q = str(req.query.q, 60);
  const filter = {};
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: re }, { email: re }, { phone: re }];
  }
  const users = await User.find(filter).select('-passwordHash -reset').sort({ createdAt: -1 }).limit(50);
  res.json(users);
}));

router.patch('/users/:id/block', wrap(async (req, res) => {
  if (String(req.user._id) === req.params.id) {
    return res.status(400).json({ error: 'You cannot block yourself' });
  }
  const blocked = req.body?.blocked === true;

  const user = await User.findByIdAndUpdate(req.params.id, { isBlocked: blocked }, { new: true });
  if (!user) return res.status(404).json({ error: 'Not found' });

  await logAction(req.user, blocked ? 'user.block' : 'user.unblock', 'User', user._id, user.name);
  res.json({ ok: true });
}));

router.patch('/users/:id/roles', wrap(async (req, res) => {
  if (String(req.user._id) === req.params.id) {
    return res.status(400).json({ error: 'You cannot change your own roles' });
  }
  if (!Array.isArray(req.body?.roles)) return res.status(400).json({ error: 'roles must be a list' });

  const wanted = req.body.roles.filter((r) => ASSIGNABLE_ROLES.includes(r));

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });

  user.roles = ['user', ...new Set(wanted)]; // everyone always stays a "user"
  if (user.roles.includes('volunteer')) user.volunteer.status = 'approved';
  else if (user.volunteer.status === 'approved') user.volunteer.status = 'none';
  await user.save();

  await logAction(req.user, 'user.roles', 'User', user._id, `${user.name}: ${user.roles.join(', ')}`);
  res.json({ ok: true });
}));



router.get('/blocked-phones', wrap(async (req, res) => {
  res.json(await BlockedPhone.find().sort({ createdAt: -1 }).limit(200));
}));

router.delete('/blocked-phones/:id', wrap(async (req, res) => {
  const item = await BlockedPhone.findByIdAndDelete(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  await logAction(req.user, 'phone.unblock', 'BlockedPhone', item.phone);
  res.json({ ok: true });
}));



router.get('/logs', wrap(async (req, res) => {
  res.json(await AuditLog.find().sort({ createdAt: -1 }).limit(100));
}));

module.exports = router;