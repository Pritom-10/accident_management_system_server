const mongoose = require("mongoose");

const helpOrgSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    category: {
      type: String,
      enum: ["legal", "counseling", "rehab", "other"],
      required: true,
    },
    description: { type: String, maxlength: 400 },
    phone: { type: String, required: true, maxlength: 30 },
    website: { type: String, maxlength: 200 },
    address: { type: String, maxlength: 200 },
    division: { type: String, default: "All" },
    district: { type: String, default: "All" },
    free: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
    verifiedAt: { type: Date },
  },
  { timestamps: true },
);

helpOrgSchema.index({ active: 1, category: 1, district: 1 });

module.exports = mongoose.model("HelpOrg", helpOrgSchema);
