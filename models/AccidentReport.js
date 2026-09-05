const mongoose = require('mongoose');


const accidentReportSchema = new mongoose.Schema(
  {
    caseId: { type: String, required: true, unique: true }, 

    accidentType: { type: String, required: true }, 
    description: { type: String, required: true },
    photoUrl: { type: String },

    location: {
      division: { type: String, required: true },
      district: { type: String, required: true },
      area: { type: String, required: true },
      address: { type: String },
    },

    dateTime: { type: Date, required: true },

    reporterPhone: { type: String, required: true },


    status: {
      type: String,
      enum: ['pending', 'verified', 'rescue_in_progress', 'cleared', 'rejected'],
      default: 'pending',
    },
    rejectionReason: { type: String },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    verifiedAt: { type: Date },


    dispatch: {
      notifiedVolunteers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Volunteer' }],
      acceptedVolunteer: { type: mongoose.Schema.Types.ObjectId, ref: 'Volunteer', default: null },
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
accidentReportSchema.index({ status: 1 });

module.exports = mongoose.model('AccidentReport', accidentReportSchema);
