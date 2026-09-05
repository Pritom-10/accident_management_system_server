const mongoose = require('mongoose');


const hospitalSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    type: { type: String, enum: ['hospital', 'fire_service', 'police', 'ambulance', 'other'], required: true },
    address: { type: String, required: true },
    phone: { type: String, required: true },
    division: { type: String, required: true },
    district: { type: String, required: true },
    isPinned: { type: Boolean, default: false }, 
  },
  { timestamps: true }
);

hospitalSchema.index({ name: 'text' });

module.exports = mongoose.model('Hospital', hospitalSchema);
