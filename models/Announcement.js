const mongoose = require('mongoose');

/**
 * 3.13 - manually-triggered broadcast (system-wide alerts, disaster warnings)
 * sent to all subscribers and/or all volunteers. Separate from the automatic
 * per-district email in 1.7/2.4.
 */
const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    message: { type: String, required: true },
    audience: { type: String, enum: ['subscribers', 'volunteers', 'both'], required: true },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Announcement', announcementSchema);
