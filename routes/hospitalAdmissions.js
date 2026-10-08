const express = require('express');
const router = express.Router();
const Hospital = require('../models/Hospital');
const HospitalAdmission = require('../models/HospitalAdmission');

router.get('/', async (req, res) => {
  try {
    const list = await HospitalAdmission.find({ status: 'admitted' })
      .populate('hospital', 'name')
      .sort({ createdAt: -1 });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { hospital, patientCount, caseId, note } = req.body;
    const count = Number(patientCount);

    if (!hospital || !Number.isInteger(count) || count < 1) {
      return res.status(400).json({ error: 'hospital and a patientCount of 1 or more are required' });
    }
    const exists = await Hospital.findById(hospital);
    if (!exists) return res.status(404).json({ error: 'Hospital not found' });

    const admission = await HospitalAdmission.create({
      hospital,
      patientCount: count,
      caseId: caseId || undefined,
      note: note || undefined,
    });
    res.status(201).json(admission);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id/discharge', async (req, res) => {
  try {
    const admission = await HospitalAdmission.findByIdAndUpdate(
      req.params.id,
      { status: 'discharged', dischargedAt: new Date() },
      { new: true }
    );
    if (!admission) return res.status(404).json({ error: 'Not found' });
    res.json(admission);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;