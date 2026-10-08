const express = require('express');
const multer = require('multer');
const router = express.Router();
const Image = require('../models/Image');

// Keep the file in memory (not on disk), then save it to MongoDB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// POST /api/upload  (form field name must be "image") -> returns { url }
router.post('/upload', (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No image received' });

    try {
      const img = await Image.create({
        data: req.file.buffer,
        contentType: req.file.mimetype,
        size: req.file.size,
      });
      const url = `${req.protocol}://${req.get('host')}/api/images/${img._id}`;
      res.status(201).json({ url });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// GET /api/images/:id -> sends the picture itself (so <img src="..."> works)
router.get('/images/:id', async (req, res) => {
  try {
    const img = await Image.findById(req.params.id);
    if (!img) return res.status(404).send('Not found');
    res.set('Content-Type', img.contentType);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(img.data);
  } catch {
    res.status(404).send('Not found');
  }
});

module.exports = router;
