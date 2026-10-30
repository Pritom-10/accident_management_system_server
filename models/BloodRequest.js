const mongoose = require("mongoose");
const { BLOOD_GROUPS } = require("../utils/blood");

const responseSchema = new mongoose.Schema(
  {
    donor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    donorName: { type: String },
    donorPhone: { type: String },
    donorGroup: { type: String },
    status: {
      type: String,
      enum: ["offered", "donated", "withdrawn"],
      default: "offered",
    },
    at: { type: Date, default: Date.now },
    stars: { type: Number, min: 1, max: 5 },
    ratedAt: { type: Date },
  },
  { _id: false },
);

const bloodRequestSchema = new mongoose.Schema(
  {
    requester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    requesterName: { type: String },

    patientName: { type: String, required: true, trim: true, maxlength: 80 },
    bloodGroup: { type: String, enum: BLOOD_GROUPS, required: true },
    unitsNeeded: { type: Number, required: true, min: 1, max: 10 },
    unitsDonated: { type: Number, default: 0 },

    hospital: {
      name: { type: String, required: true, trim: true, maxlength: 120 },
      address: { type: String, maxlength: 200 },
    },
    location: {
      division: { type: String, required: true },
      district: { type: String, required: true },
      area: { type: String },
    },

    neededBy: { type: Date, required: true },
    contactPhone: { type: String, required: true },
    note: { type: String, maxlength: 300 },

    status: {
      type: String,
      enum: ["pending", "accepted", "completed", "cancelled"],
      default: "pending",
    },
    cancelledReason: { type: String },

    responses: { type: [responseSchema], default: [] },
  },
  { timestamps: true },
);

bloodRequestSchema.methods.refreshStatus = function () {
  if (this.status === "cancelled") return;
  const donated = this.responses.filter((r) => r.status === "donated").length;
  this.unitsDonated = donated;

  if (donated >= this.unitsNeeded) this.status = "completed";
  else if (
    this.responses.some((r) => r.status === "offered" || r.status === "donated")
  )
    this.status = "accepted";
  else this.status = "pending";
};

bloodRequestSchema.index({ status: 1, neededBy: 1 });
bloodRequestSchema.index({ requester: 1, createdAt: -1 });
bloodRequestSchema.index({ "responses.donor": 1 });

module.exports = mongoose.model("BloodRequest", bloodRequestSchema);
