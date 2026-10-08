const express = require('express');
const router = express.Router();
const Hospital = require('../models/Hospital');
const HospitalAdmission = require('../models/HospitalAdmission');

router.get('/', async (req, res) => {
  try {
    const hospitals = await Hospital.find().sort({ isPinned: -1, name: 1 }).lean();

    const counts = await HospitalAdmission.aggregate([
      { $match: { status: 'admitted' } },
      { $group: { _id: '$hospital', total: { $sum: '$patientCount' } } },
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.total]));

    res.json(hospitals.map((h) => ({ ...h, patientCount: countMap.get(String(h._id)) || 0 })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;