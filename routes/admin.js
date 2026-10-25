const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const User = require('../models/User');
const NewsPost = require('../models/NewsPost');
const Campaign = require('../models/Campaign');
const SosAlert = require('../models/SosAlert');
const { activeSince } = require('../utils/sos');
const { withTimeout } = require('../utils/push');
const { pushNews } = require('../utils/pushNotify');
const AccidentReport = require('../models/AccidentReport');
const UnidentifiedPatient = require('../models/UnidentifiedPatient');
const BloodRequest = require('../models/BloodRequest');
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
  const [
    pendingReports,
    flaggedReports,
    pendingVolunteers,
    pendingPatients,
    pendingNews,
    pendingCampaigns,
    flaggedCampaigns,
    activeSos,
    users,
  ] = await Promise.all([
    AccidentReport.countDocuments({ status: 'pending' }),
    AccidentReport.countDocuments({ status: { $in: PUBLIC_STATUSES }, 'flags.0': { $exists: true } }),
    User.countDocuments({ 'volunteer.status': 'pending' }),
    UnidentifiedPatient.countDocuments({ status: 'pending' }),
    NewsPost.countDocuments({ status: 'pending' }),
    Campaign.countDocuments({ status: 'pending' }),
    Campaign.countDocuments({ status: { $in: ['active', 'completed'] }, 'flags.0': { $exists: true } }),
    SosAlert.countDocuments({ status: 'active', createdAt: { $gte: activeSince() } }),
    User.countDocuments(),
  ]);
  res.json({
    pendingReports,
    flaggedReports,
    pendingVolunteers,
    pendingPatients,
    pendingNews,
    pendingCampaigns,
    flaggedCampaigns,
    activeSos,
    users,
  });
}));


const REPORT_FILTERS = {
  pending: ['pending'],
  verified: PUBLIC_STATUSES,
  rejected: ['rejected'],
};

router.get('/news', wrap(async (req, res) => {
  const status = ['pending', 'published', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const list = await NewsPost.find({ status }).sort({ createdAt: -1 }).limit(200);
  res.json(list);
}));


router.patch('/news/:id/approve', wrap(async (req, res) => {
  const post = await NewsPost.findById(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });

  post.status = 'published';
  post.isVerified = req.body?.verified === true;
  post.rejectionReason = undefined;
  post.publishedAt = post.publishedAt || new Date();
  await post.save();

  await logAction(req.user, 'news.approve', 'NewsPost', post._id, `${post.title} (${post.isVerified ? 'verified' : 'unverified'})`);

  let alerted = 0;
  if (req.body?.breaking === true) {
    try {
      alerted = await withTimeout(pushNews(post), 4000);
    } catch (err) {
      console.error('news push failed:', err.message);
    }
  }

  res.json({ ok: true, alerted });
}));

router.post('/news/:id/alert', wrap(async (req, res) => {
  const post = await NewsPost.findById(req.params.id);
  if (!post || post.status !== 'published') return res.status(404).json({ error: 'Only a published post can be sent as an alert' });
  if (post.pushedAt) return res.status(400).json({ error: 'An alert was already sent for this post' });

  const alerted = await withTimeout(pushNews(post), 4000);
  await logAction(req.user, 'news.alert', 'NewsPost', post._id, post.title);
  res.json({ ok: true, alerted });
}));


router.patch('/news/:id/verify', wrap(async (req, res) => {
  const verified = req.body?.verified === true;
  const post = await NewsPost.findByIdAndUpdate(req.params.id, { isVerified: verified }, { new: true });
  if (!post) return res.status(404).json({ error: 'Not found' });

  await logAction(req.user, verified ? 'news.verify' : 'news.unverify', 'NewsPost', post._id, post.title);
  res.json({ ok: true });
}));


router.patch('/news/:id/reject', wrap(async (req, res) => {
  const post = await NewsPost.findById(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });

  post.status = 'rejected';
  post.isVerified = false;
  post.rejectionReason = str(req.body?.reason) || 'Not approved';
  await post.save();

  await logAction(req.user, 'news.reject', 'NewsPost', post._id, `${post.title}: ${post.rejectionReason}`);
  res.json({ ok: true });
}));

router.get('/reports', wrap(async (req, res) => {
  let filter = { status: 'pending' };
  if (req.query.status === 'verified') filter = { status: { $in: PUBLIC_STATUSES } };
  else if (req.query.status === 'rejected') filter = { status: 'rejected' };
  else if (req.query.status === 'flagged') {
    filter = { status: { $in: PUBLIC_STATUSES }, 'flags.0': { $exists: true } };
  }

  const reports = await AccidentReport.find(filter)
    .select('-flags.ipHash')
    .sort({ createdAt: -1 })
    .limit(200);
  res.json(reports);
}));


router.patch('/reports/:id/status', wrap(async (req, res) => {
  const status = req.body?.status;
  if (!['rescue_in_progress', 'cleared'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }



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

router.patch('/reports/:id/clear-flags', wrap(async (req, res) => {
  const report = await AccidentReport.findByIdAndUpdate(req.params.id, { flags: [] }, { new: true });
  if (!report) return res.status(404).json({ error: 'Not found' });

  await logAction(req.user, 'report.clear-flags', 'AccidentReport', report.caseId);
  res.json({ ok: true });
}));

router.get('/volunteers', wrap(async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const list = await User.find({ 'volunteer.status': status })
    .select('-passwordHash -reset -security')
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
  const users = await User.find(filter).select('-passwordHash -reset -security').sort({ createdAt: -1 }).limit(50);
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


router.get('/blood', wrap(async (req, res) => {
  const filter =
    req.query.status === 'closed'
      ? { status: { $in: ['completed', 'cancelled'] } }
      : { status: { $in: ['pending', 'accepted'] } };
  res.json(await BloodRequest.find(filter).sort({ createdAt: -1 }).limit(200));
}));

router.patch('/blood/:id/cancel', wrap(async (req, res) => {
  const request = await BloodRequest.findById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Not found' });

  request.status = 'cancelled';
  request.cancelledReason = str(req.body?.reason, 200) || 'Removed by admin';
  await request.save();

  await logAction(req.user, 'blood.cancel', 'BloodRequest', request._id, `${request.bloodGroup} at ${request.hospital.name}: ${request.cancelledReason}`);
  res.json({ ok: true });
}));

router.delete('/blood/:id', wrap(async (req, res) => {
  const request = await BloodRequest.findByIdAndDelete(req.params.id);
  if (!request) return res.status(404).json({ error: 'Not found' });

  await logAction(req.user, 'blood.delete', 'BloodRequest', request._id, `${request.bloodGroup} at ${request.hospital.name}`);
  res.json({ ok: true });
}));

router.get('/campaigns', wrap(async (req, res) => {
  let filter = { status: 'pending' };
  if (req.query.status === 'active') filter = { status: { $in: ['active', 'completed'] } };
  else if (req.query.status === 'flagged') {
    filter = { status: { $in: ['active', 'completed'] }, 'flags.0': { $exists: true } };
  } else if (req.query.status === 'closed') filter = { status: { $in: ['closed', 'rejected'] } };

  res.json(await Campaign.find(filter).select('-flags.ipHash').sort({ createdAt: -1 }).limit(200));
}));

router.patch('/campaigns/:id/approve', wrap(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });
  if (!['pending', 'rejected'].includes(campaign.status)) {
    return res.status(400).json({ error: 'Only a waiting or rejected campaign can be approved' });
  }

  campaign.status = 'active';
  campaign.isVerified = true;
  campaign.verifiedAt = new Date();
  campaign.rejectionReason = undefined;
  await campaign.save();

  await logAction(req.user, 'campaign.approve', 'Campaign', campaign._id, campaign.title);
  res.json({ ok: true });
}));

router.patch('/campaigns/:id/reject', wrap(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });

  campaign.status = 'rejected';
  campaign.isVerified = false;
  campaign.rejectionReason = str(req.body?.reason) || 'Not approved';
  await campaign.save();

  await logAction(req.user, 'campaign.reject', 'Campaign', campaign._id, `${campaign.title}: ${campaign.rejectionReason}`);
  res.json({ ok: true });
}));

router.patch('/campaigns/:id/clear-flags', wrap(async (req, res) => {
  const campaign = await Campaign.findByIdAndUpdate(req.params.id, { flags: [] }, { new: true });
  if (!campaign) return res.status(404).json({ error: 'Not found' });

  await logAction(req.user, 'campaign.clear-flags', 'Campaign', campaign._id, campaign.title);
  res.json({ ok: true });
}));

router.get('/sos', wrap(async (req, res) => {
  const filter = req.query.status === 'closed' ? { status: { $ne: 'active' } } : { status: 'active' };
  const list = await SosAlert.find(filter).select('-ipHash').sort({ createdAt: -1 }).limit(100);
  res.json(list);
}));

router.patch('/sos/:id/resolve', wrap(async (req, res) => {
  const alert = await SosAlert.findById(req.params.id);
  if (!alert) return res.status(404).json({ error: 'Not found' });

  alert.status = 'resolved';
  alert.resolvedAt = new Date();
  await alert.save();

  await logAction(req.user, 'sos.resolve', 'SosAlert', alert._id, [alert.location?.area, alert.location?.district].filter(Boolean).join(', '));
  res.json({ ok: true });
}));

router.patch('/sos/:id/false-alarm', wrap(async (req, res) => {
  const alert = await SosAlert.findById(req.params.id);
  if (!alert) return res.status(404).json({ error: 'Not found' });

  alert.status = 'false_alarm';
  alert.resolvedAt = new Date();
  await alert.save();

  let blocked = false;
  if (req.body?.blockPhone === true && alert.callerPhone) {
    const key = phoneKey(alert.callerPhone);
    if (key) {
      await BlockedPhone.updateOne(
        { phone: key },
        { $setOnInsert: { reason: 'False SOS alert', blockedBy: req.user._id } },
        { upsert: true }
      );
      blocked = true;
    }
  }

  await logAction(req.user, 'sos.false-alarm', 'SosAlert', alert._id, blocked ? 'number blocked' : '');
  res.json({ ok: true, blocked });
}));

router.get('/logs', wrap(async (req, res) => {
  res.json(await AuditLog.find().sort({ createdAt: -1 }).limit(100));
}));

module.exports = router;