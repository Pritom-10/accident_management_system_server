const mongoose = require('mongoose');
const { METHODS } = require('../utils/money');

const donationPlanSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    amount: { type: Number, required: true, min: 10 },
    method: { type: String, enum: METHODS, required: true },
    frequency: { type: String, enum: ['weekly', 'monthly'], required: true },
    nextDue: { type: Date, required: true },
    active: { type: Boolean, default: true },
    lastRemindedAt: { type: Date },
    remindedCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

donationPlanSchema.index({ active: 1, nextDue: 1 });
donationPlanSchema.index({ user: 1, campaign: 1 }, { unique: true });

module.exports = mongoose.model('DonationPlan', donationPlanSchema);