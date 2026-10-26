const mongoose = require('mongoose');

const newsReactionSchema = new mongoose.Schema(
  {
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'NewsPost', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['helpful', 'sad', 'care'], required: true },
  },
  { timestamps: true }
);

newsReactionSchema.index({ post: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('NewsReaction', newsReactionSchema);