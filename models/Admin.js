const mongoose = require('mongoose');

/**
 * 3.1 - single Administrator role, no Super Admin / Moderator tiers.
 */
const adminSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Admin', adminSchema);
