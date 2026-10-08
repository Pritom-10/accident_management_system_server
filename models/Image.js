const mongoose = require('mongoose');

// Stores an uploaded image directly inside MongoDB
const imageSchema = new mongoose.Schema(
  {
    data: { type: Buffer, required: true },        // the actual image bytes
    contentType: { type: String, required: true }, // e.g. "image/jpeg"
    size: { type: Number },                        // bytes
  },
  { timestamps: true }
);

module.exports = mongoose.model('Image', imageSchema);
