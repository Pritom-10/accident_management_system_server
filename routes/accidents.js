const express = require('express');
const router = express.Router();
const AccidentReport = require('../models/AccidentReport');


router.post('/', async (req, res) => {
  try {
    const report = await AccidentReport.create(req.body);
    res.status(201).json(report);
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
