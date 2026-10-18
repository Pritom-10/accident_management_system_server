const mongoose = require('mongoose');

const flagSchema = new mongoose.Schema(
  {
    ipHash: { type: String, required: true },
    reason: { type: String, maxlength: 200 },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const accidentReportSchema = new mongoose.Schema(
  {
    caseId: { type: String, required: true, unique: true },

    accidentType: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    photoUrl: { type: String },

    location: {
      division: { type: String, required: true },
      district: { type: String, required: true },
      area: { type: String },
      address: { type: String },
      lat: { type: Number, min: -90, max: 90 },
      lng: { type: Number, min: -180, max: 180 },
    },

    dateTime: { type: Date, required: true },
    reporterPhone: { type: String, required: true },

    status: {
      type: String,
      enum: ['pending', 'verified', 'rescue_in_progress', 'cleared', 'rejected'],
      default: 'pending',
    },
    rejectionReason: { type: String },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: { type: Date },

    flags: { type: [flagSchema], default: [] },

    dispatch: {
      notifiedVolunteers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      acceptedVolunteer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      assistanceStatus: {
        type: String,
        enum: ['unassigned', 'accepted', 'on_the_way', 'completed', 'cannot_assist'],
        default: 'unassigned',
      },
    },

    donation: {
      isEnabled: { type: Boolean, default: false },
      totalRaised: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

accidentReportSchema.index({ 'location.division': 1, 'location.district': 1, 'location.area': 1 });
accidentReportSchema.index({ status: 1, dateTime: -1 });

module.exports = mongoose.model('AccidentReport', accidentReportSchema);