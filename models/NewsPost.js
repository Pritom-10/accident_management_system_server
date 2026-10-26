const mongoose = require('mongoose');
const { VEHICLES } = require('../utils/newsOptions');

const UPDATE_KINDS = ['injured', 'case', 'compensation', 'general'];

const updateSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: UPDATE_KINDS, default: 'general' },
    text: { type: String, required: true, maxlength: 1500 },
    at: { type: Date, required: true },
    deaths: { type: Number, min: 0 },
    injured: { type: Number, min: 0 },
    approved: { type: Boolean, default: false },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    authorName: { type: String },
  },
  { timestamps: true }
);

const sourceSchema = new mongoose.Schema({ name: { type: String }, url: { type: String } }, { _id: false });

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
    extraSources: { type: [sourceSchema], default: [] },

    status: { type: String, enum: ['pending', 'published', 'rejected', 'merged'], default: 'pending' },
    isVerified: { type: Boolean, default: false },
    rejectionReason: { type: String },
    publishedAt: { type: Date },
    pushedAt: { type: Date },
    mergedInto: { type: mongoose.Schema.Types.ObjectId, ref: 'NewsPost' },

    updates: { type: [updateSchema], default: [] },
    updateCount: { type: Number, default: 0 },
    lastUpdateAt: { type: Date },

    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    authorName: { type: String },
  },
  { timestamps: true }
);

newsPostSchema.methods.refreshUpdates = function () {
  const live = this.updates.filter((u) => u.approved);
  this.updateCount = live.length;
  this.lastUpdateAt = live.length ? new Date(Math.max(...live.map((u) => new Date(u.at).getTime()))) : undefined;
};

newsPostSchema.index({ status: 1, occurredAt: -1 });
newsPostSchema.index({ 'location.division': 1, 'location.district': 1, 'location.area': 1 });

module.exports = mongoose.model('NewsPost', newsPostSchema);