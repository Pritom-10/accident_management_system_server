const mongoose = require('mongoose');

/**
 * 1.5, 3.7
 * NOTE: "I recognize this person" flag/report button and the admin-informs-hospital
 * step have been dropped from scope — this is now a display-only, admin-verified list.
 */
const unidentifiedPatientSchema = new mongoose.Schema(
  {
    photoUrl: { type: String },
    estimatedAge: { type: Number },
    admittingHospital: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
    admissionDate: { type: Date, required: true },
    physicalDescription: { type: String, required: true },

    status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('UnidentifiedPatient', unidentifiedPatientSchema);
