const mongoose = require("mongoose");

const ROLES = [
  "user",
  "donor",
  "volunteer",
  "admin",
  "hospital",
  "bloodbank",
  "ngo",
  "journalist",
];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    email: {
      type: String,
      lowercase: true,
      trim: true,
      unique: true,
      sparse: true,
    },
    phone: { type: String, unique: true, sparse: true },

    passwordHash: { type: String, required: true },

    roles: { type: [{ type: String, enum: ROLES }], default: ["user"] },

    photoUrl: { type: String },
    bloodGroup: {
      type: String,
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
    },
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
      status: {
        type: String,
        enum: ["none", "pending", "approved", "rejected"],
        default: "none",
      },
      skills: [{ type: String, enum: ["first_aid", "driving", "other"] }],
      serviceArea: {
        division: { type: String },
        district: { type: String },
        area: { type: String },
      },
      availability: {
        type: String,
        enum: ["available", "unavailable"],
        default: "unavailable",
      },
      rejectionReason: { type: String },
    },

    donor: {
      isDonor: { type: Boolean, default: false },
      dateOfBirth: { type: Date },
      weightKg: { type: Number, min: 30, max: 250 },
      lastDonationDate: { type: Date },
      availability: {
        type: String,
        enum: ["available", "unavailable"],
        default: "available",
      },
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

    donorRating: {
      sum: { type: Number, default: 0 },
      count: { type: Number, default: 0 },
    },
    rewards: {
      showOnBoard: { type: Boolean, default: false },
    },
    medicalId: {
      enabled: { type: Boolean, default: false },
      token: { type: String, index: true },
      allergies: { type: String, maxlength: 300 },
      conditions: { type: String, maxlength: 300 },
      medications: { type: String, maxlength: 300 },
      notes: { type: String, maxlength: 300 },
      showPhone: { type: Boolean, default: true },
    },

    verification: {
      status: {
        type: String,
        enum: ["none", "pending", "approved", "rejected"],
        default: "none",
      },
      docType: {
        type: String,
        enum: ["nid", "license", "passport", "student"],
      },
      images: [{ type: String }],
      submittedAt: { type: Date },
      reviewedAt: { type: Date },
      reason: { type: String, maxlength: 200 },
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
  { timestamps: true },
);

userSchema.methods.toPublic = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  delete obj.reset;
  delete obj.security;
  obj.verified = Boolean(
    obj.verification && obj.verification.status === "approved",
  );
  obj.verificationStatus =
    (obj.verification && obj.verification.status) || "none";
  delete obj.verification;
  delete obj.medicalId;
  delete obj.emailChange;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model("User", userSchema);
