const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const NewsPost = require('../models/NewsPost');
const NewsComment = require('../models/NewsComment');
const NewsReaction = require('../models/NewsReaction');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const TYPES = ['helpful', 'sad', 'care'];
const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|xyz|info|bd|co|me|ly)\b)/i;
const PAGE = 10;
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => res.status(500).json({ error: err.message }));

['newsId', 'id'].forEach((name) =>
  router.param(name, (req, res, next, value) => {
    if (!mongoose.isValidObjectId(value)) return res.status(404).json({ error: 'Not found' });
    next();
  })
);

const isPublished = (newsId) => NewsPost.exists({ _id: newsId, status: 'published' });

function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  return v
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'A reader';
  return parts[1] ? `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.` : parts[0];
}

function shapeComment(c, viewer) {
  const authorId = c.author && (c.author._id || c.author);
  return {
    _id: c._id,
    name: shortName(c.authorName),
    photoUrl: c.author && c.author.photoUrl ? c.author.photoUrl : undefined,
    text: c.text,
    createdAt: c.createdAt,
    mine: Boolean(viewer && authorId && String(authorId) === String(viewer._id)),
  };
}

async function summaryFor(newsId, userId) {
  const oid = new mongoose.Types.ObjectId(String(newsId));
  const [grouped, commentCount, mine] = await Promise.all([
    NewsReaction.aggregate([{ $match: { post: oid } }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
    NewsComment.countDocuments({ news: oid, status: 'visible' }),
    userId ? NewsReaction.findOne({ post: oid, user: userId }).select('type').lean() : null,
  ]);

  const counts = { helpful: 0, sad: 0, care: 0 };
  grouped.forEach((g) => {
    if (counts[g._id] !== undefined) counts[g._id] = g.n;
  });

  return { counts, commentCount, mine: mine ? mine.type : null };
}

router.get('/news/:newsId/summary', optionalAuth, wrap(async (req, res) => {
  if (!(await isPublished(req.params.newsId))) return res.status(404).json({ error: 'Not found' });
  res.json(await summaryFor(req.params.newsId, req.user && req.user._id));
}));

router.put('/news/:newsId/reaction', requireAuth, wrap(async (req, res) => {
  if (!(await isPublished(req.params.newsId))) return res.status(404).json({ error: 'Not found' });

  const type = req.body ? req.body.type : null;
  const key = { post: req.params.newsId, user: req.user._id };

  if (type === null || type === undefined) {
    await NewsReaction.deleteOne(key);
  } else if (TYPES.includes(type)) {
    await NewsReaction.updateOne(key, { $set: { type } }, { upsert: true });
  } else {
    return res.status(400).json({ error: 'Invalid reaction' });
  }

  res.json(await summaryFor(req.params.newsId, req.user._id));
}));

router.get('/news/:newsId/comments', optionalAuth, wrap(async (req, res) => {
  if (!(await isPublished(req.params.newsId))) return res.status(404).json({ error: 'Not found' });

  const page = Math.min(500, Math.max(1, parseInt(req.query.page, 10) || 1));
  const filter = { news: req.params.newsId, status: 'visible' };

  const [total, rows] = await Promise.all([
    NewsComment.countDocuments(filter),
    NewsComment.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * PAGE)
      .limit(PAGE)
      .populate('author', 'photoUrl')
      .lean(),
  ]);

  res.json({
    items: rows.map((c) => shapeComment(c, req.user)),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE)),
  });
}));

router.post('/news/:newsId/comments', requireAuth, wrap(async (req, res) => {
  if (!(await isPublished(req.params.newsId))) return res.status(404).json({ error: 'Not found' });

  const text = cleanText(req.body && req.body.text, 800);
  if (text.length < 2) return res.status(400).json({ error: 'Write a little more' });
  if (LINK_RE.test(text)) return res.status(400).json({ error: 'Links are not allowed in comments' });

  const user = req.user;
  const [recent, today, repeated] = await Promise.all([
    NewsComment.countDocuments({ author: user._id, createdAt: { $gte: new Date(Date.now() - 10 * MIN) } }),
    NewsComment.countDocuments({ author: user._id, createdAt: { $gte: new Date(Date.now() - DAY) } }),
    NewsComment.exists({ author: user._id, news: req.params.newsId, text, createdAt: { $gte: new Date(Date.now() - DAY) } }),
  ]);

  if (recent >= 5) return res.status(429).json({ error: 'You are commenting very fast. Please wait a few minutes.' });
  if (today >= 30) return res.status(429).json({ error: 'You reached the limit for today. Please come back tomorrow.' });
  if (repeated) return res.status(409).json({ error: 'You already wrote this comment' });

  const created = await NewsComment.create({
    news: req.params.newsId,
    author: user._id,
    authorName: user.name,
    text,
  });

  res.status(201).json(
    shapeComment({ ...created.toObject(), author: { _id: user._id, photoUrl: user.photoUrl } }, user)
  );
}));

router.delete('/comments/:id', requireAuth, wrap(async (req, res) => {
  const comment = await NewsComment.findById(req.params.id);
  if (!comment || comment.status === 'removed') return res.status(404).json({ error: 'Not found' });

  const admin = req.user.roles.includes('admin');
  if (!admin && String(comment.author) !== String(req.user._id)) {
    return res.status(403).json({ error: 'You can only delete your own comment' });
  }

  comment.status = 'removed';
  await comment.save();
  res.json({ ok: true });
}));

router.post('/comments/:id/report', requireAuth, wrap(async (req, res) => {
  const comment = await NewsComment.findById(req.params.id);
  if (!comment || comment.status === 'removed') return res.status(404).json({ error: 'Not found' });

  if (String(comment.author) === String(req.user._id)) {
    return res.status(400).json({ error: 'You cannot report your own comment' });
  }
  if (comment.reports.some((r) => String(r.user) === String(req.user._id))) {
    return res.status(409).json({ error: 'You already reported this comment' });
  }

  if (comment.reports.length < 30) {
    comment.reports.push({ user: req.user._id, reason: cleanText(req.body && req.body.reason, 120) });
    comment.reportCount = comment.reports.length;
  }
  if (!comment.reviewedAt && comment.status === 'visible' && comment.reportCount >= 3) comment.status = 'hidden';

  await comment.save();
  res.json({ ok: true });
}));

module.exports = router;