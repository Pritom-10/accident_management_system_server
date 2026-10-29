const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const Hospital = require('../models/Hospital');
const { requireAuth } = require('../middleware/auth');
const { readStatus, shapeStatus } = require('../utils/hospital');
const { logAction } = require('../utils/audit');

const isAdminUser = (u) => u.roles.includes('admin');
const isStaff = (u) => u.roles.includes('hospital') || u.roles.includes('bloodbank');
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => res.status(500).json({ error: err.message }));

router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) return res.status(404).json({ error: 'Not found' });
  next();
});

router.get('/mine', wrap(async (req, res) => {
  const admin = isAdminUser(req.user);
  if (!admin && !isStaff(req.user)) return res.status(403).json({ error: 'This page is for hospital and blood bank staff' });

  const filter = admin ? {} : { managers: req.user._id };
  const list = await Hospital.find(filter)
    .sort({ name: 1 })
    .limit(admin ? 300 : 20)
    .lean();

  res.json(
    list.map((h) => ({
      _id: h._id,
      name: h.name,
      type: h.type,
      district: h.district,
      address: h.address,
      status: shapeStatus(h),
    }))
  );
}));

router.put('/:id/status', wrap(async (req, res) => {
  const hospital = await Hospital.findById(req.params.id);
  if (!hospital) return res.status(404).json({ error: 'Not found' });

  const admin = isAdminUser(req.user);
  const manager = isStaff(req.user) && hospital.managers.some((m) => String(m) === String(req.user._id));
  if (!admin && !manager) return res.status(403).json({ error: 'You do not manage this place' });

  const { data, error } = readStatus(req.body);
  if (error) return res.status(400).json({ error });

  await Hospital.updateOne(
    { _id: hospital._id },
    { $set: { ...data, statusUpdatedAt: new Date(), statusUpdatedBy: req.user._id, statusUpdatedByName: req.user.name } }
  );

  if (admin && !manager) await logAction(req.user, 'hospital.status', 'Hospital', hospital._id, hospital.name);
  res.json({ ok: true });
}));

module.exports = router;