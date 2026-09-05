const mongoose = require('mongoose');



const missingPersonSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    age: { type: Number, required: true },
    gender: { type: String, enum: ['male', 'female', 'other'] },
    physicalDescription: { type: String },
    photoUrl: { type: String },

    lastKnownLocation: {
      division: { type: String, required: true },
      district: { type: String, required: true },
      area: { type: String, required: true },
      address: { type: String },
    },
    lastSeenDateTime: { type: Date, required: true },

    reporterContact: { type: String, required: true }, 

    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    rejectionReason: { type: String },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

missingPersonSchema.index({ name: 'text' });
missingPersonSchema.index({ status: 1 });

module.exports = mongoose.model('MissingPerson', missingPersonSchema);
