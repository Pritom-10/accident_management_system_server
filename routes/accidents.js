const express = require('express');
const router = express.Router();
const AccidentReport = require('../models/AccidentReport');
const BlockedPhone = require('../models/BlockedPhone');
const { normalizeBdNumber } = require('../utils/phone');

const str = (v) => (typeof v === 'string' ? v.trim() : '');


router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    const loc = b.location || {};

    const reporterPhone = str(b.reporterPhone);


    const key = normalizeBdNumber(reporterPhone) || reporterPhone.replace(/\D/g, '');
    if (key && (await BlockedPhone.exists({ phone: key }))) {
      return res.status(403).json({ error: 'This mobile number is not allowed to submit reports' });
    }

    const dateTime = b.dateTime ? new Date(b.dateTime) : new Date();
    if (Number.isNaN(dateTime.getTime())) {
      return res.status(400).json({ error: 'Invalid date and time' });
    }

    const report = await AccidentReport.create({
      caseId: `ACC-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 90 + 10)}`,
      accidentType: str(b.accidentType),
      description: str(b.description),
      photoUrl: str(b.photoUrl) || undefined,
      location: {
        division: str(loc.division),
        district: str(loc.district),
        area: str(loc.area),
        address: str(loc.address),
      },
      dateTime,
      reporterPhone,
    });

    res.status(201).json({ ok: true, caseId: report.caseId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


router.get('/', async (req, res) => {
  try {
    const reports = await AccidentReport.find({
      status: { $in: ['rescue_in_progress', 'cleared'] },
    }).sort({ createdAt: -1 });
    res.json(reports);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;