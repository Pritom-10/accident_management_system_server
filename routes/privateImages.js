const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const router = express.Router();
const Image = require('../models/Image');
const { requireAuth } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

router.post('/private-images', requireAuth, (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No image received' });

    try {
      const img = await Image.create({
        data: req.file.buffer,
        contentType: req.file.mimetype,
        size: req.file.size,
        isPrivate: true,
        uploadedBy: req.user._id,
      });
      res.status(201).json({ id: img._id, url: `/api/private-images/${img._id}` });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

router.get('/private-images/:id', requireAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).send('Not found');

    const img = await Image.findById(req.params.id);
    const allowed =
      img && img.isPrivate && (req.user.roles.includes('admin') || String(img.uploadedBy) === String(req.user._id));
    if (!allowed) return res.status(404).send('Not found');

    res.set('Content-Type', img.contentType);
    res.set('Cache-Control', 'private, no-store');
    res.send(img.data);
  } catch {
    res.status(404).send('Not found');
  }
});

module.exports = router;