const mongoose = require('mongoose');

const count = { type: Number, min: 0 };

const hospitalSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ['hospital', 'blood_bank', 'fire_service', 'police', 'ambulance', 'other'],
      required: true,
    },
    address: { type: String, required: true },
    phone: { type: String, required: true },
    division: { type: String, required: true },
    district: { type: String, required: true },
    isPinned: { type: Boolean, default: false },

    managers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    beds: { total: count, available: count },
    icu: { total: count, available: count },
    bloodStock: { Ap: count, An: count, Bp: count, Bn: count, ABp: count, ABn: count, Op: count, On: count },
    acceptingEmergency: { type: Boolean, default: true },

    statusUpdatedAt: { type: Date },
    statusUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    statusUpdatedByName: { type: String },
  },
  { timestamps: true }
);

hospitalSchema.index({ name: 'text' });
hospitalSchema.index({ managers: 1 });
hospitalSchema.index({ district: 1, type: 1 });

module.exports = mongoose.model('Hospital', hospitalSchema);