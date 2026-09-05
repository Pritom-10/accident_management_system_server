const express = require('express');
const router = express.Router();
const MissingPerson = require('../models/MissingPerson');

router.get('/', async (req, res) => {
  try {
    const people = await MissingPerson.find({ status: 'approved' }).sort({ createdAt: -1 });
    res.json(people);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const person = await MissingPerson.create(req.body);
    res.status(201).json(person);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
