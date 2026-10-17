const mongoose = require('mongoose');

const blockedPhoneSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true }, 
    reason: { type: String },
    blockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BlockedPhone', blockedPhoneSchema);