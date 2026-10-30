const express = require('express');
const router = express.Router();

const Image = require('../models/Image');
const { requireAuth } = require('../middleware/auth');

const PRIVATE_RE = /^\/api\/private-images\/([a-f0-9]{24})$/;
const DOCS = ['nid', 'license', 'passport', 'student'];
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => res.status(500).json({ error: err.message }));

router.use(requireAuth);

router.get('/me', (req, res) => {
  const v = req.user.verification || {};
  res.json({ status: v.status || 'none', docType: v.docType || null, reason: v.reason || '', submittedAt: v.submittedAt || null });
});

router.post('/', wrap(async (req, res) => {
  const u = req.user;
  const status = (u.verification && u.verification.status) || 'none';
  if (status === 'approved') return res.status(400).json({ error: 'You are already verified' });
  if (status === 'pending') return res.status(400).json({ error: 'Your documents are already waiting for review' });

  const b = req.body || {};
  if (!DOCS.includes(b.docType)) return res.status(400).json({ error: 'Choose the type of document' });

  const urls = Array.isArray(b.images) ? b.images.map((i) => String(i).trim()).filter(Boolean) : [];
  const ids = urls.map((x) => (PRIVATE_RE.exec(x) || [])[1]);
  if (ids.length < 1 || ids.length > 2 || ids.some((i) => !i)) {
    return res.status(400).json({ error: 'Add 1 or 2 photos of the document' });
  }

  const unique = [...new Set(ids)];
  const owned = await Image.countDocuments({ _id: { $in: unique }, isPrivate: true, uploadedBy: u._id });
  if (owned !== unique.length) return res.status(400).json({ error: 'Please upload your photos again' });

  u.verification = {
    status: 'pending',
    docType: b.docType,
    images: unique.map((i) => `/api/private-images/${i}`),
    submittedAt: new Date(),
  };
  await u.save();

  res.status(201).json({ ok: true });
}));

module.exports = router;