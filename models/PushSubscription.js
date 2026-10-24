const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema(
  {
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    district: { type: String, default: '' },
    prefs: {
      sos: { type: Boolean, default: false },
      blood: { type: Boolean, default: true },
      news: { type: Boolean, default: true },
      campaigns: { type: Boolean, default: true },
    },
    ipHash: { type: String },
    failures: { type: Number, default: 0 },
    lastSentAt: { type: Date },
  },
  { timestamps: true }
);

pushSubscriptionSchema.index({ user: 1 });
pushSubscriptionSchema.index({ 'prefs.news': 1, district: 1 });
pushSubscriptionSchema.index({ ipHash: 1, createdAt: -1 });

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);