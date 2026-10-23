const mongoose = require('mongoose');

const responderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String },
    phone: { type: String },
    status: { type: String, enum: ['on_the_way', 'arrived', 'cannot'], default: 'on_the_way' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const sosAlertSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true },
    caller: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    callerName: { type: String, maxlength: 60 },
    callerPhone: { type: String },
    note: { type: String, maxlength: 200 },

    location: {
      lat: { type: Number, min: -90, max: 90 },
      lng: { type: Number, min: -180, max: 180 },
      accuracy: { type: Number },
      division: { type: String },
      district: { type: String },
      area: { type: String },
    },

    status: { type: String, enum: ['active', 'resolved', 'false_alarm', 'cancelled'], default: 'active' },
    responders: { type: [responderSchema], default: [] },
    resolvedAt: { type: Date },
    ipHash: { type: String },
  },
  { timestamps: true }
);

sosAlertSchema.index({ status: 1, createdAt: -1 });
sosAlertSchema.index({ ipHash: 1, createdAt: -1 });
sosAlertSchema.index({ 'location.lat': 1, 'location.lng': 1 });

module.exports = mongoose.model('SosAlert', sosAlertSchema);