const express = require('express');
const router = express.Router();
const Hospital = require('../models/Hospital');
const HospitalAdmission = require('../models/HospitalAdmission');
const { BLOOD_GROUPS } = require('../utils/blood');
const { KEYS, STALE_MS, shapeStatus } = require('../utils/hospital');

const str = (v, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.get('/', async (req, res) => {
  try {
    const hospitals = await Hospital.find()
      .select('-managers -statusUpdatedBy -statusUpdatedByName')
      .sort({ isPinned: -1, name: 1 })
      .lean();

    const counts = await HospitalAdmission.aggregate([
      { $match: { status: 'admitted' } },
      { $group: { _id: '$hospital', total: { $sum: '$patientCount' } } },
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.total]));

    res.json(
      hospitals.map((h) => {
        const { beds, icu, bloodStock, acceptingEmergency, statusUpdatedAt, ...rest } = h;
        return { ...rest, patientCount: countMap.get(String(h._id)) || 0, status: shapeStatus(h) };
      })
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/blood-stock', async (req, res) => {
  try {
    const group = str(req.query.group, 3);
    if (!BLOOD_GROUPS.includes(group)) return res.status(400).json({ error: 'Choose a blood group' });

    const field = `bloodStock.${KEYS[group]}`;
    const filter = {
      [field]: { $gt: 0 },
      statusUpdatedAt: { $gte: new Date(Date.now() - STALE_MS) },
    };

    const district = str(req.query.district, 50);
    if (district) filter.district = new RegExp(`^${escapeRegex(district)}$`, 'i');

    const rows = await Hospital.find(filter)
      .sort({ [field]: -1 })
      .limit(10)
      .select(`name type address phone district statusUpdatedAt ${field}`)
      .lean();

    res.json(
      rows.map((h) => ({
        _id: h._id,
        name: h.name,
        type: h.type,
        address: h.address,
        phone: h.phone,
        district: h.district,
        units: h.bloodStock[KEYS[group]],
        updatedAt: h.statusUpdatedAt,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;