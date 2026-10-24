const mongoose = require('mongoose');
const { VEHICLES } = require('../utils/newsOptions');

const newsPostSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, required: true, maxlength: 10000 },

    photos: [{ type: String }], 
    videoUrl: { type: String },

    occurredAt: { type: Date, required: true }, 
    location: {
      division: { type: String, required: true },
      district: { type: String, required: true },
      area: { type: String },
      address: { type: String },
    },

    road: { type: String },
    vehicleTypes: [{ type: String, enum: VEHICLES }],
    deaths: { type: Number, default: 0, min: 0 },
    injured: { type: Number, default: 0, min: 0 },

    sourceName: { type: String },
    sourceUrl: { type: String },

    
    status: { type: String, enum: ['pending', 'published', 'rejected'], default: 'pending' },
    isVerified: { type: Boolean, default: false }, 
    rejectionReason: { type: String },
    publishedAt: { type: Date },
    pushedAt: { type: Date },

    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    authorName: { type: String },
  },
  { timestamps: true }
);

newsPostSchema.index({ status: 1, occurredAt: -1 });
newsPostSchema.index({ 'location.division': 1, 'location.district': 1, 'location.area': 1 });

module.exports = mongoose.model('NewsPost', newsPostSchema);