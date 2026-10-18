const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const AccidentReport = require('../models/AccidentReport');
const BlockedPhone = require('../models/BlockedPhone');
const { normalizeBdNumber } = require('../utils/phone');

const PUBLIC_STATUSES = ['rescue_in_progress', 'cleared'];
const PUBLIC_FIELDS = '-reporterPhone -flags -verifiedBy -rejectionReason -__v';

const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const insideBangladesh = (lat, lng) => lat >= 20.5 && lat <= 26.7 && lng >= 88 && lng <= 92.8;

function readCoordinates(b) {
  if (b.lat === undefined || b.lat === null || b.lat === '') return { ok: true };
  const lat = Number(b.lat);
  const lng = Number(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !insideBangladesh(lat, lng)) {
    return { error: 'The map location must be inside Bangladesh' };
  }
  return { ok: true, lat, lng };
}

function buildFilter(q) {
  const filter = {};
  const status = str(q.status, 30);
  filter.status = PUBLIC_STATUSES.includes(status) ? status : { $in: PUBLIC_STATUSES };

  const division = str(q.division, 50);
  const district = str(q.district, 50);
  const area = str(q.area, 50);
  if (division) filter['location.division'] = division;
  if (district) filter['location.district'] = district;
  if (area) filter['location.area'] = area;
  return filter;
}

router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    const loc = b.location || {};

    const accidentType = str(b.accidentType, 100);
    const description = str(b.description, 3000);
    const division = str(loc.division, 50);
    const district = str(loc.district, 50);

    if (accidentType.length < 3) return res.status(400).json({ error: 'Write what kind of accident it is' });
    if (description.length < 10) return res.status(400).json({ error: 'Describe what happened in a few words' });
    if (!division || !district) return res.status(400).json({ error: 'Choose a division and a district' });

    const phone = normalizeBdNumber(b.reporterPhone);
    if (!phone) {
      return res.status(400).json({ error: 'Enter a valid Bangladeshi mobile number, like 01712345678' });
    }
    if (await BlockedPhone.exists({ phone })) {
      return res.status(403).json({ error: 'This mobile number is not allowed to submit reports' });
    }

    const dateTime = b.dateTime ? new Date(b.dateTime) : new Date();
    if (Number.isNaN(dateTime.getTime())) {
      return res.status(400).json({ error: 'Invalid date and time' });
    }
    if (dateTime.getTime() > Date.now() + 60 * 60 * 1000) {
      return res.status(400).json({ error: 'The date and time cannot be in the future' });
    }

    const coords = readCoordinates(b);
    if (coords.error) return res.status(400).json({ error: coords.error });

    const report = await AccidentReport.create({
      caseId: `ACC-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 90 + 10)}`,
      accidentType,
      description,
      photoUrl: str(b.photoUrl, 500) || undefined,
      location: {
        division,
        district,
        area: str(loc.area, 50),
        address: str(loc.address, 200),
        lat: coords.lat,
        lng: coords.lng,
      },
      dateTime,
      reporterPhone: phone,
    });

    res.status(201).json({ ok: true, caseId: report.caseId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const reports = await AccidentReport.find({ status: { $in: PUBLIC_STATUSES } })
      .select(PUBLIC_FIELDS)
      .sort({ createdAt: -1 });
    res.json(reports);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/search', async (req, res) => {
  try {
    const filter = buildFilter(req.query);
    const limit = Math.min(24, Math.max(1, parseInt(req.query.limit, 10) || 9));
    const page = Math.min(1000, Math.max(1, parseInt(req.query.page, 10) || 1));

    const [total, items] = await Promise.all([
      AccidentReport.countDocuments(filter),
      AccidentReport.find(filter)
        .select(PUBLIC_FIELDS)
        .sort({ dateTime: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/map', async (req, res) => {
  try {
    const filter = {
      ...buildFilter(req.query),
      'location.lat': { $type: 'number' },
      'location.lng': { $type: 'number' },
    };

    const pins = await AccidentReport.find(filter)
      .select('caseId accidentType status dateTime location.area location.district location.lat location.lng')
      .sort({ dateTime: -1 })
      .limit(500)
      .lean();

    res.json(pins);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:caseId', async (req, res) => {
  try {
    const report = await AccidentReport.findOne({
      caseId: str(req.params.caseId, 60),
      status: { $in: PUBLIC_STATUSES },
    }).select(PUBLIC_FIELDS);

    if (!report) return res.status(404).json({ error: 'Not found' });
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:caseId/flag', async (req, res) => {
  try {
    const report = await AccidentReport.findOne({
      caseId: str(req.params.caseId, 60),
      status: { $in: PUBLIC_STATUSES },
    });
    if (!report) return res.status(404).json({ error: 'Not found' });

    const ipHash = crypto
      .createHash('sha256')
      .update(`${req.ip}|${process.env.JWT_SECRET}`)
      .digest('hex');

    if (report.flags.some((f) => f.ipHash === ipHash)) {
      return res.status(409).json({ error: 'You have already reported this case' });
    }

    if (report.flags.length < 50) {
      report.flags.push({ ipHash, reason: str(req.body?.reason, 200) });
      await report.save();
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;