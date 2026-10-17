const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    adminName: { type: String },
    action: { type: String, required: true }, 
    targetType: { type: String },             
    targetId: { type: String },
    details: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AuditLog', auditLogSchema);