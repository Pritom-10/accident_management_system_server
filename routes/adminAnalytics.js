const express = require('express');
const router = express.Router();

const AccidentReport = require('../models/AccidentReport');
const NewsPost = require('../models/NewsPost');
const User = require('../models/User');
const BloodRequest = require('../models/BloodRequest');
const Campaign = require('../models/Campaign');
const Donation = require('../models/Donation');
const SosAlert = require('../models/SosAlert');
const { requireAuth, requireRole } = require('../middleware/auth');
const { BLOOD_GROUPS } = require('../utils/blood');
const { logAction } = require('../utils/audit');

router.use(requireAuth, requireRole('admin'));

const DAY = 24 * 60 * 60 * 1000;
const TZ = 6 * 60 * 60 * 1000;
const PUBLIC = ['rescue_in_progress', 'cleared'];
const PERIODS = { 7: 7, 30: 30, 90: 90, 365: 365 };

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => res.status(500).json({ error: err.message }));

function getRange(q) {
  const key = String(q.days || '30');
  const to = new Date();
  if (key === 'all') return { key, to, from: null };
  const days = PERIODS[key] || 30;
  return { key: String(days), to, from: new Date(to.getTime() - days * DAY) };
}

function bucketStart(ms, unit) {
  const shifted = ms + TZ;
  const dayStart = Math.floor(shifted / DAY) * DAY;
  if (unit === 'day') return dayStart;
  if (unit === 'week') {
    const dow = (new Date(dayStart).getUTCDay() + 6) % 7;
    return dayStart - dow * DAY;
  }
  const d = new Date(shifted);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function nextStart(start, unit) {
  if (unit === 'day') return start + DAY;
  if (unit === 'week') return start + 7 * DAY;
  const d = new Date(start);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

function fill(rows, getMs, getVal, from, to, unit) {
  const out = [];
  const index = new Map();
  let cur = bucketStart(from.getTime(), unit);
  const end = bucketStart(to.getTime(), unit);

  while (cur <= end && out.length < 400) {
    index.set(cur, out.length);
    out.push({ at: new Date(cur).toISOString().slice(0, 10), value: 0 });
    cur = nextStart(cur, unit);
  }

  for (const r of rows) {
    const ms = getMs(r);
    if (!Number.isFinite(ms)) continue;
    const i = index.get(bucketStart(ms, unit));
    if (i !== undefined) out[i].value += getVal(r);
  }
  return out;
}

function bump(map, key, label) {
  const cur = map.get(key);
  if (cur) cur.count += 1;
  else map.set(key, { label, count: 1 });
}

function topN(map, n) {
  return [...map.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
    .map((v) => ({ name: v.label, count: v.count }));
}

const change = (prev, cur, before) => {
  if (prev === null) return undefined;
  if (before === 0) return cur === 0 ? 0 : null;
  return Math.round(((cur - before) / before) * 100);
};

async function loadTotals() {
  const [users, volunteers, donors, campaignsLive, money, stories, verifiedCases] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ roles: 'volunteer', 'volunteer.status': 'approved' }),
    User.countDocuments({ 'donor.isDonor': true }),
    Campaign.countDocuments({ status: 'active' }),
    Campaign.aggregate([
      { $match: { status: { $in: ['active', 'completed', 'closed'] } } },
      { $group: { _id: null, raised: { $sum: '$raised' }, spent: { $sum: '$spent' } } },
    ]),
    NewsPost.countDocuments({ status: 'published' }),
    AccidentReport.countDocuments({ status: { $in: PUBLIC } }),
  ]);

  return {
    users,
    volunteers,
    donors,
    campaignsLive,
    raisedAll: money[0] ? money[0].raised : 0,
    spentAll: money[0] ? money[0].spent : 0,
    stories,
    verifiedCases,
  };
}

router.get('/overview', wrap(async (req, res) => {
  const range = getRange(req.query);
  const to = range.to;
  let from = range.from;

  if (!from) {
    const [firstCase, firstUser] = await Promise.all([
      AccidentReport.findOne({ status: { $in: PUBLIC } }).sort({ dateTime: 1 }).select('dateTime').lean(),
      User.findOne().sort({ createdAt: 1 }).select('createdAt').lean(),
    ]);
    const stamps = [firstCase && firstCase.dateTime, firstUser && firstUser.createdAt]
      .filter(Boolean)
      .map((d) => new Date(d).getTime())
      .filter(Number.isFinite);
    from = new Date(Math.min(...stamps, to.getTime()));
    const cap = new Date(to);
    cap.setMonth(cap.getMonth() - 35);
    if (from < cap) from = cap;
  }

  const spanDays = (to.getTime() - from.getTime()) / DAY;
  const unit = spanDays <= 45 ? 'day' : spanDays <= 150 ? 'week' : 'month';

  const [cases, news, newUsers, bloodRows, donationRows, sosRows, totals] = await Promise.all([
    AccidentReport.find({ status: { $in: PUBLIC }, dateTime: { $gte: from, $lte: to } })
      .select('dateTime accidentType status location.district')
      .limit(50000)
      .lean(),
    NewsPost.find({ status: 'published', occurredAt: { $gte: from, $lte: to } })
      .select('deaths injured vehicleTypes')
      .limit(20000)
      .lean(),
    User.find({ createdAt: { $gte: from, $lte: to } }).select('createdAt').limit(50000).lean(),
    BloodRequest.find({ createdAt: { $gte: from, $lte: to } })
      .select('createdAt status bloodGroup unitsNeeded unitsDonated')
      .limit(50000)
      .lean(),
    Donation.find({ status: 'confirmed', confirmedAt: { $gte: from, $lte: to } })
      .select('confirmedAt amount')
      .limit(50000)
      .lean(),
    SosAlert.find({ createdAt: { $gte: from, $lte: to } }).select('createdAt status responders.status').limit(50000).lean(),
    loadTotals(),
  ]);

  let prev = null;
  if (range.from) {
    const span = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - span);
    const window = { $gte: prevFrom, $lt: from };
    const [c, u, b, d, s] = await Promise.all([
      AccidentReport.countDocuments({ status: { $in: PUBLIC }, dateTime: window }),
      User.countDocuments({ createdAt: window }),
      BloodRequest.countDocuments({ createdAt: window }),
      Donation.aggregate([
        { $match: { status: 'confirmed', confirmedAt: window } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      SosAlert.countDocuments({ createdAt: window }),
    ]);
    prev = { cases: c, users: u, blood: b, raised: d[0] ? d[0].total : 0, sos: s };
  }

  const ms = (field) => (r) => new Date(r[field]).getTime();
  const one = () => 1;

  const series = {
    cases: fill(cases, ms('dateTime'), one, from, to, unit),
    users: fill(newUsers, ms('createdAt'), one, from, to, unit),
    blood: fill(bloodRows, ms('createdAt'), one, from, to, unit),
    raised: fill(donationRows, ms('confirmedAt'), (r) => r.amount, from, to, unit),
    sos: fill(sosRows, ms('createdAt'), one, from, to, unit),
  };

  const byHour = Array(24).fill(0);
  const byWeekday = Array(7).fill(0);
  const districts = new Map();
  const types = new Map();
  let rescue = 0;
  let cleared = 0;

  for (const r of cases) {
    const t = new Date(r.dateTime).getTime();
    if (Number.isFinite(t)) {
      const local = new Date(t + TZ);
      byHour[local.getUTCHours()] += 1;
      byWeekday[(local.getUTCDay() + 6) % 7] += 1;
    }

    const district = String((r.location && r.location.district) || '').trim();
    if (district) bump(districts, district.toLowerCase(), district);

    const type = String(r.accidentType || '').trim();
    if (type) bump(types, type.toLowerCase(), type);

    if (r.status === 'rescue_in_progress') rescue += 1;
    else cleared += 1;
  }

  let deaths = 0;
  let injured = 0;
  const vehicles = new Map();
  for (const n of news) {
    deaths += n.deaths || 0;
    injured += n.injured || 0;
    (n.vehicleTypes || []).forEach((v) => bump(vehicles, v, v));
  }

  const bloodStatus = { pending: 0, accepted: 0, completed: 0, cancelled: 0 };
  const groupCounts = Object.fromEntries(BLOOD_GROUPS.map((g) => [g, 0]));
  let unitsNeeded = 0;
  let unitsDonated = 0;
  for (const b of bloodRows) {
    if (bloodStatus[b.status] !== undefined) bloodStatus[b.status] += 1;
    if (groupCounts[b.bloodGroup] !== undefined) groupCounts[b.bloodGroup] += 1;
    unitsNeeded += b.unitsNeeded || 0;
    unitsDonated += b.unitsDonated || 0;
  }

  let sosAnswered = 0;
  let sosResolved = 0;
  let sosFalse = 0;
  for (const s of sosRows) {
    if ((s.responders || []).some((r) => r.status !== 'cannot')) sosAnswered += 1;
    if (s.status === 'resolved') sosResolved += 1;
    if (s.status === 'false_alarm') sosFalse += 1;
  }

  const raised = donationRows.reduce((sum, d) => sum + d.amount, 0);

  res.json({
    period: { key: range.key, unit, from, to },
    kpis: {
      cases: { value: cases.length, change: change(prev, cases.length, prev && prev.cases) },
      users: { value: newUsers.length, change: change(prev, newUsers.length, prev && prev.users) },
      blood: { value: bloodRows.length, change: change(prev, bloodRows.length, prev && prev.blood) },
      raised: { value: raised, change: change(prev, raised, prev && prev.raised) },
      sos: { value: sosRows.length, change: change(prev, sosRows.length, prev && prev.sos) },
    },
    series,
    charts: {
      total: cases.length,
      byHour,
      byWeekday,
      districts: topN(districts, 10),
      types: topN(types, 8),
      status: { rescue, cleared },
    },
    casualties: { deaths, injured, stories: news.length, vehicles: topN(vehicles, 8) },
    blood: { status: bloodStatus, groups: groupCounts, total: bloodRows.length, unitsNeeded, unitsDonated },
    money: { raised, donations: donationRows.length },
    sos: { total: sosRows.length, answered: sosAnswered, resolved: sosResolved, falseAlarm: sosFalse },
    totals,
  });
}));

function csvCell(v) {
  if (v === undefined || v === null) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const exporters = {
  accidents: async (start, end) => {
    const rows = await AccidentReport.find({ dateTime: { $gte: start, $lte: end } })
      .sort({ dateTime: -1 })
      .limit(20000)
      .lean();
    return {
      header: ['Case ID', 'Type', 'Status', 'Division', 'District', 'Upazila', 'Latitude', 'Longitude', 'Happened at (UTC)', 'Reported at (UTC)'],
      rows: rows.map((r) => [
        r.caseId,
        r.accidentType,
        r.status,
        r.location && r.location.division,
        r.location && r.location.district,
        r.location && r.location.area,
        r.location && r.location.lat,
        r.location && r.location.lng,
        r.dateTime,
        r.createdAt,
      ]),
    };
  },

  news: async (start, end) => {
    const rows = await NewsPost.find({ occurredAt: { $gte: start, $lte: end } })
      .sort({ occurredAt: -1 })
      .limit(20000)
      .lean();
    return {
      header: ['Title', 'Status', 'Verified', 'Division', 'District', 'Upazila', 'Road', 'Vehicles', 'Dead', 'Injured', 'Happened at (UTC)', 'Source'],
      rows: rows.map((r) => [
        r.title,
        r.status,
        r.isVerified ? 'yes' : 'no',
        r.location && r.location.division,
        r.location && r.location.district,
        r.location && r.location.area,
        r.road,
        (r.vehicleTypes || []).join(' | '),
        r.deaths,
        r.injured,
        r.occurredAt,
        r.sourceName,
      ]),
    };
  },

  blood: async (start, end) => {
    const rows = await BloodRequest.find({ createdAt: { $gte: start, $lte: end } })
      .sort({ createdAt: -1 })
      .limit(20000)
      .lean();
    return {
      header: ['Blood group', 'Bags needed', 'Bags donated', 'Status', 'Hospital', 'Division', 'District', 'Needed by (UTC)', 'Asked at (UTC)'],
      rows: rows.map((r) => [
        r.bloodGroup,
        r.unitsNeeded,
        r.unitsDonated,
        r.status,
        r.hospital && r.hospital.name,
        r.location && r.location.division,
        r.location && r.location.district,
        r.neededBy,
        r.createdAt,
      ]),
    };
  },

  donations: async (start, end) => {
    const rows = await Donation.find({ createdAt: { $gte: start, $lte: end } })
      .populate('campaign', 'title')
      .sort({ createdAt: -1 })
      .limit(20000)
      .lean();
    return {
      header: ['Receipt', 'Campaign', 'Amount (BDT)', 'Method', 'Status', 'Submitted at (UTC)', 'Confirmed at (UTC)'],
      rows: rows.map((r) => [
        r.receiptNo,
        r.campaign && r.campaign.title,
        r.amount,
        r.method,
        r.status,
        r.createdAt,
        r.confirmedAt,
      ]),
    };
  },
};

router.get('/export/:kind', wrap(async (req, res) => {
  const build = exporters[req.params.kind];
  if (!build) return res.status(404).json({ error: 'Unknown report' });

  const range = getRange(req.query);
  const { header, rows } = await build(range.from || new Date(0), range.to);

  const body = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');

  await logAction(req.user, 'export', 'Export', req.params.kind, `${range.key} days, ${rows.length} rows`);

  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.send(`\uFEFF${body}`);
}));

module.exports = router;