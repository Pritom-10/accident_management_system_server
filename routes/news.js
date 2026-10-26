const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const NewsPost = require('../models/NewsPost');
const { requireAuth, requireRole } = require('../middleware/auth');
const { VEHICLES } = require('../utils/newsOptions');
const { logAction } = require('../utils/audit');
const { withTimeout } = require('../utils/push');
const { pushNews } = require('../utils/pushNotify');
const { applyCounts } = require('../utils/newsUpdates');

const WRITERS = ['admin', 'journalist'];
const KINDS = ['injured', 'case', 'compensation', 'general'];
const IMAGE_RE = /^(https?:\/\/|\/api\/images\/)/i;
const HTTP_RE = /^https?:\/\//i;
const DAY = 24 * 60 * 60 * 1000;
const LIST_HIDE = '-author -updates -extraSources -mergedInto';

const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasValue = (v) => v !== undefined && v !== null && v !== '';

router.param('id', (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) return res.status(404).json({ error: 'Not found' });
  next();
});

router.param('updateId', (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) return res.status(404).json({ error: 'Not found' });
  next();
});

function toCount(v) {
  const n = Number(v === '' || v === undefined || v === null ? 0 : v);
  return Number.isInteger(n) && n >= 0 && n <= 10000 ? n : null;
}

function readNewsInput(b = {}) {
  const title = str(b.title, 200);
  const body = str(b.body, 10000);
  if (title.length < 5) return { error: 'The title must be at least 5 characters' };
  if (body.length < 20) return { error: 'The details must be at least 20 characters' };

  const loc = b.location || {};
  const division = str(loc.division, 50);
  const district = str(loc.district, 50);
  if (!division || !district) return { error: 'Choose a division and a district' };

  const occurredAt = new Date(b.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) return { error: 'Enter a valid date and time' };
  if (occurredAt.getTime() > Date.now() + DAY) return { error: 'The accident date cannot be in the future' };

  const photos = Array.isArray(b.photos) ? b.photos.map((p) => str(p, 500)).filter(Boolean) : [];
  if (photos.length > 4) return { error: 'You can add up to 4 photos' };
  if (photos.some((p) => !IMAGE_RE.test(p))) return { error: 'One of the photo links is not valid' };

  const videoUrl = str(b.videoUrl, 500);
  if (videoUrl && !HTTP_RE.test(videoUrl)) return { error: 'The video link must start with http:// or https://' };

  const sourceUrl = str(b.sourceUrl, 500);
  if (sourceUrl && !HTTP_RE.test(sourceUrl)) return { error: 'The source link must start with http:// or https://' };

  const deaths = toCount(b.deaths);
  const injured = toCount(b.injured);
  if (deaths === null || injured === null) return { error: 'Deaths and injured must be whole numbers (0 or more)' };

  const vehicleTypes = Array.isArray(b.vehicleTypes)
    ? [...new Set(b.vehicleTypes.filter((v) => VEHICLES.includes(v)))]
    : [];

  return {
    data: {
      title,
      body,
      photos,
      videoUrl: videoUrl || undefined,
      occurredAt,
      location: { division, district, area: str(loc.area, 50), address: str(loc.address, 200) },
      road: str(b.road, 150),
      vehicleTypes,
      deaths,
      injured,
      sourceName: str(b.sourceName, 100),
      sourceUrl: sourceUrl || undefined,
    },
  };
}

const isAdminUser = (user) => user.roles.includes('admin');
const isOwner = (post, user) => String(post.author) === String(user._id);

router.get('/', async (req, res) => {
  try {
    const filter = { status: 'published' };

    const q = str(req.query.q, 60);
    if (q) {
      const re = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ title: re }, { body: re }, { road: re }, { 'location.area': re }, { 'location.district': re }];
    }

    const division = str(req.query.division, 50);
    const district = str(req.query.district, 50);
    const area = str(req.query.area, 50);
    if (division) filter['location.division'] = division;
    if (district) filter['location.district'] = district;
    if (area) filter['location.area'] = area;

    if (VEHICLES.includes(req.query.vehicle)) filter.vehicleTypes = req.query.vehicle;
    if (req.query.verified === '1') filter.isVerified = true;

    const limit = Math.min(24, Math.max(1, parseInt(req.query.limit, 10) || 9));
    const page = Math.min(1000, Math.max(1, parseInt(req.query.page, 10) || 1));

    const [total, items] = await Promise.all([
      NewsPost.countDocuments(filter),
      NewsPost.find(filter)
        .sort({ occurredAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select(LIST_HIDE)
        .lean(),
    ]);

    res.json({
      items: items.map((i) => ({ ...i, body: i.body.slice(0, 220) })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/mine', requireAuth, requireRole(...WRITERS), async (req, res) => {
  try {
    const posts = await NewsPost.find({ author: req.user._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .select('-body -updates');
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/manage', requireAuth, requireRole(...WRITERS), async (req, res) => {
  try {
    const post = await NewsPost.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Not found' });
    if (!isAdminUser(req.user) && !isOwner(post, req.user)) {
      return res.status(403).json({ error: 'You can only edit your own posts' });
    }
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const post = await NewsPost.findById(req.params.id).select('-author');
    if (!post) return res.status(404).json({ error: 'Not found' });

    if (post.status === 'merged' && post.mergedInto) {
      return res.json({ merged: true, mergedInto: post.mergedInto });
    }
    if (post.status !== 'published') return res.status(404).json({ error: 'Not found' });

    const out = post.toObject();
    out.updates = (out.updates || [])
      .filter((u) => u.approved)
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .map((u) => ({ _id: u._id, kind: u.kind, text: u.text, at: u.at, deaths: u.deaths, injured: u.injured }));
    delete out.mergedInto;
    delete out.__v;

    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requireAuth, requireRole(...WRITERS), async (req, res) => {
  try {
    const { data, error } = readNewsInput(req.body);
    if (error) return res.status(400).json({ error });

    const admin = isAdminUser(req.user);

    const post = await NewsPost.create({
      ...data,
      author: req.user._id,
      authorName: req.user.name,
      status: admin ? 'published' : 'pending',
      isVerified: admin && req.body?.isVerified === true,
      publishedAt: admin ? new Date() : undefined,
    });

    let alerted = 0;
    if (admin && req.body && req.body.breaking === true) {
      try {
        alerted = await withTimeout(pushNews(post), 4000);
      } catch (err) {
        console.error('news push failed:', err.message);
      }
    }

    res.status(201).json({ id: post._id, status: post.status, alerted });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', requireAuth, requireRole(...WRITERS), async (req, res) => {
  try {
    const post = await NewsPost.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Not found' });
    if (post.status === 'merged') return res.status(400).json({ error: 'This story was merged into another one' });

    const admin = isAdminUser(req.user);
    if (!admin && !isOwner(post, req.user)) {
      return res.status(403).json({ error: 'You can only edit your own posts' });
    }

    const { data, error } = readNewsInput(req.body);
    if (error) return res.status(400).json({ error });

    Object.assign(post, data);

    if (admin) {
      if (typeof req.body?.isVerified === 'boolean') post.isVerified = req.body.isVerified;
    } else {
      post.status = 'pending';
      post.isVerified = false;
      post.rejectionReason = undefined;
    }

    await post.save();
    res.json({ id: post._id, status: post.status });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', requireAuth, requireRole(...WRITERS), async (req, res) => {
  try {
    const post = await NewsPost.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Not found' });

    const admin = isAdminUser(req.user);
    if (!admin) {
      if (!isOwner(post, req.user)) return res.status(403).json({ error: 'You can only delete your own posts' });
      if (post.status === 'published') {
        return res.status(403).json({ error: 'A published post can only be removed by an admin' });
      }
    }

    await post.deleteOne();
    if (admin) await logAction(req.user, 'news.delete', 'NewsPost', post._id, post.title);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/updates', requireAuth, requireRole(...WRITERS), async (req, res) => {
  try {
    const post = await NewsPost.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Not found' });
    if (post.status !== 'published') {
      return res.status(400).json({ error: 'Updates can only be added to a published story' });
    }

    const admin = isAdminUser(req.user);
    if (!admin && !isOwner(post, req.user)) {
      return res.status(403).json({ error: 'You can only add updates to your own stories' });
    }
    if (post.updates.length >= 40) return res.status(400).json({ error: 'This story already has too many updates' });

    const b = req.body || {};
    const kind = KINDS.includes(b.kind) ? b.kind : 'general';
    const text = str(b.text, 1500);
    if (text.length < 10) return res.status(400).json({ error: 'Write the update in at least 10 characters' });

    const at = b.at ? new Date(b.at) : new Date();
    if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + DAY) {
      return res.status(400).json({ error: 'Enter a valid date. It cannot be in the future' });
    }

    const update = { kind, text, at, approved: admin, author: req.user._id, authorName: req.user.name };

    if (hasValue(b.deaths)) {
      const n = toCount(b.deaths);
      if (n === null) return res.status(400).json({ error: 'Deaths must be a whole number (0 or more)' });
      update.deaths = n;
    }
    if (hasValue(b.injured)) {
      const n = toCount(b.injured);
      if (n === null) return res.status(400).json({ error: 'Injured must be a whole number (0 or more)' });
      update.injured = n;
    }

    post.updates.push(update);
    const added = post.updates[post.updates.length - 1];
    if (admin) applyCounts(post, added);
    post.refreshUpdates();
    await post.save();

    res.status(201).json({ id: added._id, approved: admin });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id/updates/:updateId', requireAuth, requireRole(...WRITERS), async (req, res) => {
  try {
    const post = await NewsPost.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Not found' });

    const update = post.updates.id(req.params.updateId);
    if (!update) return res.status(404).json({ error: 'Not found' });

    const admin = isAdminUser(req.user);
    if (!admin) {
      const mine = isOwner(post, req.user) && String(update.author) === String(req.user._id);
      if (!mine || update.approved) {
        return res.status(403).json({ error: 'You can only remove your own update that is waiting for review' });
      }
    }

    post.updates.pull({ _id: update._id });
    post.refreshUpdates();
    await post.save();

    if (admin) await logAction(req.user, 'news.update-remove', 'NewsPost', post._id, post.title);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;