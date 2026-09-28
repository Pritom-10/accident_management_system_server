const mongoose = require('mongoose');


const volunteerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },

    skills: [{ type: String, enum: ['first_aid', 'driving', 'other'] }],

    serviceArea: {
      division: { type: String, required: true },
      district: { type: String, required: true },
      area: { type: String },
    },
    
    profilePhotoUrl: { type: String },

    availability: { type: String, enum: ['available', 'unavailable'], default: 'unavailable' },

    approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    rejectionReason: { type: String },

    isSuspended: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Volunteer', volunteerSchema);
