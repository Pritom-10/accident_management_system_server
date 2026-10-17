const mongoose = require('mongoose');

const ROLES = ['user', 'donor', 'volunteer', 'admin', 'hospital', 'bloodbank', 'ngo', 'journalist'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    // at least one of email / phone is needed (the route checks this)
    email: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
    phone: { type: String, unique: true, sparse: true }, // saved as 8801XXXXXXXXX

    passwordHash: { type: String, required: true },

    // roles are given by the admin (or by approval), never chosen at sign up
    roles: { type: [{ type: String, enum: ROLES }], default: ['user'] },

    // profile (filled in on the profile page)
    photoUrl: { type: String },
    bloodGroup: { type: String, enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
    address: {
      division: { type: String },
      district: { type: String },
      area: { type: String },
      details: { type: String },
    },
    emergencyContact: {
      name: { type: String },
      phone: { type: String },
    },

    // volunteer application and settings
    volunteer: {
      status: { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
      skills: [{ type: String, enum: ['first_aid', 'driving', 'other'] }],
      serviceArea: {
        division: { type: String },
        district: { type: String },
        area: { type: String },
      },
      availability: { type: String, enum: ['available', 'unavailable'], default: 'unavailable' },
      rejectionReason: { type: String },
    },

    isBlocked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// what is safe to send to the browser (no password hash)
userSchema.methods.toPublic = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('User', userSchema);