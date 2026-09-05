const mongoose = require('mongoose');


const subscriberSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    division: { type: String, required: true },
    district: { type: String, required: true },
    isActive: { type: Boolean, default: true }, 
    unsubscribeToken: { type: String, required: true }, 
  },
  { timestamps: true }
);

subscriberSchema.index({ email: 1, division: 1, district: 1 }, { unique: true });

module.exports = mongoose.model('Subscriber', subscriberSchema);
