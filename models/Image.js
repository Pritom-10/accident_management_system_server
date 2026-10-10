const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema(
  {
    data: { type: Buffer, required: true },       
    contentType: { type: String, required: true },
    size: { type: Number },                        
  },
  { timestamps: true }
);

module.exports = mongoose.model('Image', imageSchema);
