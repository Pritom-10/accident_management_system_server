const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const router = express.Router();
const Image = require('../models/Image');
const { detectImage, ALLOWED } = require('../utils/imageCheck');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

router.post('/upload', (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The photo is too big (5 MB at most)' : 'Could not read the photo' });
    if (!req.file) return res.status(400).json({ error: 'No image received' });

    const type = detectImage(req.file.buffer);
    if (!type) return res.status(400).json({ error: 'Only JPEG, PNG, WebP or GIF photos are allowed' });

    try {
      const img = await Image.create({ data: req.file.buffer, contentType: type, size: req.file.size });
      res.status(201).json({ id: img._id, url: `/api/images/${img._id}` });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

router.get('/images/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).send('Not found');

    const img = await Image.findById(req.params.id);
    if (!img || img.isPrivate || !ALLOWED.includes(img.contentType)) return res.status(404).send('Not found');

    res.set('Content-Type', img.contentType);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(img.data);
  } catch {
    res.status(404).send('Not found');
  }
});

module.exports = router;