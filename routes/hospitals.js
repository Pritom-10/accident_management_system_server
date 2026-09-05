const express = require('express');
const router = express.Router();
const Hospital = require('../models/Hospital');


router.get('/', async (req, res) => {
  try {
    const hospitals = await Hospital.find().sort({ isPinned: -1, name: 1 });
    res.json(hospitals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
