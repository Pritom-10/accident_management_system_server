const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const router = express.Router();
const Image = require('../models/Image');


const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

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
      res.status(201).json({ id: img._id, url: `/api/images/${img._id}` });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

router.get('/images/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).send('Not found');
    }
    const img = await Image.findById(req.params.id);
    if (!img) return res.status(404).send('Not found');

    res.set('Content-Type', img.contentType);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin'); 
    res.send(img.data);
  } catch {
    res.status(404).send('Not found');
  }
});

module.exports = router;