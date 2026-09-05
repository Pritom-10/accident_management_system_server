const mongoose = require('mongoose');


const donationSchema = new mongoose.Schema(
  {
    accidentReport: { type: mongoose.Schema.Types.ObjectId, ref: 'AccidentReport', required: true },
    donorName: { type: String, default: 'Anonymous' },
    donorEmail: { type: String }, 
    amount: { type: Number, required: true },
    currency: { type: String, default: 'usd' },
    stripePaymentIntentId: { type: String, required: true, unique: true },
    status: { type: String, enum: ['succeeded', 'pending', 'failed'], default: 'pending' },
  },
  { timestamps: true }
);

donationSchema.index({ accidentReport: 1 });

module.exports = mongoose.model('Donation', donationSchema);
