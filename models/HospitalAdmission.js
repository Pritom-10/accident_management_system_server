const mongoose = require('mongoose');

const hospitalAdmissionSchema = new mongoose.Schema(
  {
    hospital: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
    caseId: { type: String },           
    patientCount: { type: Number, required: true, min: 1 },
    note: { type: String },
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Volunteer' }, // fill in once volunteer login exists
    status: { type: String, enum: ['admitted', 'discharged'], default: 'admitted' },
    dischargedAt: { type: Date },
  },
  { timestamps: true }
);

hospitalAdmissionSchema.index({ hospital: 1, status: 1 });

module.exports = mongoose.model('HospitalAdmission', hospitalAdmissionSchema);