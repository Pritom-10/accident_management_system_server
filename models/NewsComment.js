const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, maxlength: 120 },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const newsCommentSchema = new mongoose.Schema(
  {
    news: { type: mongoose.Schema.Types.ObjectId, ref: 'NewsPost', required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String },
    text: { type: String, required: true, maxlength: 800 },

    status: { type: String, enum: ['visible', 'hidden', 'removed'], default: 'visible' },
    reports: { type: [reportSchema], default: [] },
    reportCount: { type: Number, default: 0 },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
);

newsCommentSchema.index({ news: 1, status: 1, createdAt: -1 });
newsCommentSchema.index({ author: 1, createdAt: -1 });
newsCommentSchema.index({ status: 1, reportCount: -1 });

module.exports = mongoose.model('NewsComment', newsCommentSchema);