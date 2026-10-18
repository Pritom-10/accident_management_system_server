const express = require('express');
const router = express.Router();
const AccidentReport = require('../models/AccidentReport');

const PUBLIC_STATUSES = ['rescue_in_progress', 'cleared'];
const PERIOD_DAYS = { '7': 7, '30': 30, '90': 90, '365': 365 };
const DAY_BANDS = {
  morning: [6, 7, 8, 9, 10, 11],
  afternoon: [12, 13, 14, 15, 16],
  evening: [17, 18, 19, 20],
  night: [21, 22, 23, 0, 1, 2, 3, 4, 5],
};

const asDate = { $convert: { input: '$dateTime', to: 'date', onError: null, onNull: null } };

const str = (v, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function buildMatch(q) {
  const match = {
    status: { $in: PUBLIC_STATUSES },
    'location.lat': { $type: 'number' },
    'location.lng': { $type: 'number' },
  };

  const division = str(q.division, 50);
  const district = str(q.district, 50);
  const type = str(q.type, 100);
  if (division) match['location.division'] = division;
  if (district) match['location.district'] = district;
  if (type) match.accidentType = new RegExp(`^\\s*${escapeRegex(type)}\\s*$`, 'i');

  const conditions = [];

  const days = PERIOD_DAYS[str(q.period, 10)];
  if (days) {
    conditions.push({ $gte: [asDate, new Date(Date.now() - days * 24 * 60 * 60 * 1000)] });
  }

  const band = DAY_BANDS[str(q.band, 20)];
  if (band) {
    conditions.push({ $in: [{ $hour: { date: asDate, timezone: 'Asia/Dhaka' } }, band] });
  }

  if (conditions.length) match.$expr = { $and: conditions };

  return match;
}

router.get('/hotspots', async (req, res) => {
  try {
    const min = Math.min(50, Math.max(1, parseInt(req.query.min, 10) || 1));
    const match = buildMatch(req.query);

    const [cells, totalMatched] = await Promise.all([
      AccidentReport.aggregate([
        { $match: match },
        {
          $group: {
            _id: {
              y: { $floor: { $multiply: ['$location.lat', 100] } },
              x: { $floor: { $multiply: ['$location.lng', 100] } },
            },
            count: { $sum: 1 },
            lat: { $avg: '$location.lat' },
            lng: { $avg: '$location.lng' },
            district: { $first: '$location.district' },
            area: { $first: '$location.area' },
            latest: { $max: asDate },
          },
        },
        { $match: { count: { $gte: min } } },
        { $sort: { count: -1, latest: -1 } },
        { $limit: 500 },
        { $project: { _id: 0, count: 1, lat: 1, lng: 1, district: 1, area: 1, latest: 1 } },
      ]),
      AccidentReport.countDocuments(match),
    ]);

    res.json({ cells, totalMatched, maxCount: cells.length ? cells[0].count : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/types', async (req, res) => {
  try {
    const rows = await AccidentReport.aggregate([
      { $match: { status: { $in: PUBLIC_STATUSES } } },
      {
        $group: {
          _id: { $toLower: { $trim: { input: '$accidentType' } } },
          label: { $first: '$accidentType' },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 30 },
    ]);

    res.json(rows.map((r) => ({ value: r._id, label: String(r.label).trim(), count: r.count })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;9