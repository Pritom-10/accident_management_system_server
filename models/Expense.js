const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema(
  {
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    amount: { type: Number, required: true, min: 1 },
    spentOn: { type: Date, required: true },
    proofUrl: { type: String, required: true },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

expenseSchema.index({ campaign: 1, spentOn: -1 });

module.exports = mongoose.model('Expense', expenseSchema);