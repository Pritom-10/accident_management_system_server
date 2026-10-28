const mongoose = require('mongoose');

const ROLES = ['user', 'donor', 'volunteer', 'admin', 'hospital', 'bloodbank', 'ngo', 'journalist'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    email: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
    phone: { type: String, unique: true, sparse: true }, 

    passwordHash: { type: String, required: true },


    roles: { type: [{ type: String, enum: ROLES }], default: ['user'] },

  
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

        donor: {
      isDonor: { type: Boolean, default: false },
      dateOfBirth: { type: Date },
      weightKg: { type: Number, min: 30, max: 250 },
      lastDonationDate: { type: Date },
      availability: { type: String, enum: ['available', 'unavailable'], default: 'available' },
      contactPhone: { type: String },
      showContact: { type: Boolean, default: false },
      emailAlerts: { type: Boolean, default: true },
      donationCount: { type: Number, default: 0 },
      registeredAt: { type: Date },
    },

    isBlocked: { type: Boolean, default: false },
    deletedAt: { type: Date },

    security: {
      tokenVersion: { type: Number, default: 0 },
      failedLogins: { type: Number, default: 0 },
      lockUntil: { type: Date },
    },
    emailChange: {
      email: { type: String },
      otpHash: { type: String },
      expiresAt: { type: Date },
      attempts: { type: Number, default: 0 },
      requestedAt: { type: Date },
    },
     reset: {
      otpHash: { type: String },
      expiresAt: { type: Date },
      attempts: { type: Number, default: 0 },
      requestedAt: { type: Date },
    },
  },
  { timestamps: true }
);

userSchema.methods.toPublic = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  delete obj.reset;
  delete obj.security;
  delete obj.emailChange;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('User', userSchema);