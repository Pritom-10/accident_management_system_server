const mongoose = require('mongoose');
const { METHODS } = require('../utils/money');

const donationSchema = new mongoose.Schema(
  {
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    donor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    donorName: { type: String, maxlength: 60 },
    isAnonymous: { type: Boolean, default: false },
    donorPhone: { type: String },
    donorEmail: { type: String },

    amount: { type: Number, required: true, min: 1 },
    method: { type: String, enum: METHODS, required: true },
    trxId: { type: String, required: true },
    receiptNo: { type: String, required: true, unique: true },

    status: { type: String, enum: ['pending', 'confirmed', 'rejected', 'refunded'], default: 'pending' },
    rejectionReason: { type: String },
    confirmedAt: { type: Date },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    dispute: {
      status: { type: String, enum: ['none', 'open', 'resolved', 'refunded'], default: 'none' },
      reason: { type: String, enum: ['not_confirmed', 'wrong_amount', 'refund', 'other'] },
      message: { type: String, maxlength: 500 },
      openedAt: { type: Date },
      response: { type: String, maxlength: 500 },
      handledAt: { type: Date },
      handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      refundRef: { type: String, maxlength: 60 },
    },

    ipHash: { type: String },
  },
  { timestamps: true }
);

donationSchema.index({ method: 1, trxId: 1 }, { unique: true });
donationSchema.index({ campaign: 1, status: 1, createdAt: -1 });
donationSchema.index({ donor: 1, createdAt: -1 });
donationSchema.index({ 'dispute.status': 1, 'dispute.openedAt': -1 });

module.exports = mongoose.model('Donation', donationSchema);