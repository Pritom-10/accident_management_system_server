const mongoose = require('mongoose');
const { METHODS } = require('../utils/money');

const accountSchema = new mongoose.Schema(
  {
    method: { type: String, enum: METHODS, required: true },
    number: { type: String, required: true },
    accountName: { type: String, required: true },
    bankName: { type: String },
    branch: { type: String },
  },
  { _id: false }
);

const flagSchema = new mongoose.Schema(
  {
    ipHash: { type: String, required: true },
    reason: { type: String, maxlength: 200 },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const campaignSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ownerName: { type: String },

    title: { type: String, required: true, trim: true, maxlength: 120 },
    story: { type: String, required: true, maxlength: 5000 },
    patientName: { type: String, required: true, trim: true, maxlength: 80 },

    hospital: {
      name: { type: String, required: true, trim: true, maxlength: 120 },
      address: { type: String, maxlength: 200 },
    },
    location: {
      division: { type: String, required: true },
      district: { type: String, required: true },
      area: { type: String },
    },

    targetAmount: { type: Number, required: true, min: 100 },
    raised: { type: Number, default: 0 },
    spent: { type: Number, default: 0 },
    donorCount: { type: Number, default: 0 },

    photos: [{ type: String }],
    documents: [{ type: String }],
    paymentAccounts: { type: [accountSchema], default: [] },

    status: { type: String, enum: ['pending', 'active', 'completed', 'closed', 'rejected'], default: 'pending' },
    isVerified: { type: Boolean, default: false },
    rejectionReason: { type: String },
    verifiedAt: { type: Date },

    flags: { type: [flagSchema], default: [] },
  },
  { timestamps: true }
);

campaignSchema.index({ status: 1, createdAt: -1 });
campaignSchema.index({ owner: 1, createdAt: -1 });

module.exports = mongoose.model('Campaign', campaignSchema);