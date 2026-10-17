const express = require('express');
const router = express.Router();
const UnidentifiedPatient = require('../models/UnidentifiedPatient');
const Hospital = require('../models/Hospital');
const { requireAuth, requireRole } = require('../middleware/auth');


router.get('/', async (req, res) => {
  try {
    const patients = await UnidentifiedPatient.find({ status: 'verified' })
      .populate('admittingHospital', 'name address phone')
      .sort({ createdAt: -1 });
    res.json(patients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.post('/', requireAuth, requireRole('volunteer', 'admin'), async (req, res) => {
  try {
    const { photoUrl, estimatedAge, admittingHospital, admissionDate, physicalDescription } = req.body || {};

    if (!admittingHospital || !admissionDate || !physicalDescription || !physicalDescription.trim()) {
      return res.status(400).json({ error: 'hospital, admission date and description are required' });
    }

    const hospital = await Hospital.findById(admittingHospital);
    if (!hospital) return res.status(404).json({ error: 'Hospital not found' });

    const patient = await UnidentifiedPatient.create({
      photoUrl: photoUrl || undefined,
      estimatedAge: estimatedAge ? Number(estimatedAge) : undefined,
      admittingHospital,
      admissionDate,
      physicalDescription: physicalDescription.trim(),
      reportedBy: req.user._id,
    });

    res.status(201).json({ ok: true, id: patient._id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;