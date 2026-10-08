const mongoose = require('mongoose');


const unidentifiedPatientSchema = new mongoose.Schema(
  {
    photoUrl: { type: String },
    estimatedAge: { type: Number },
    admittingHospital: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
    admissionDate: { type: Date, required: true },
    physicalDescription: { type: String, required: true },

    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Volunteer' }, 

    status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('UnidentifiedPatient', unidentifiedPatientSchema);