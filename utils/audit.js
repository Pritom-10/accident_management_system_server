const AuditLog = require('../models/AuditLog');


async function logAction(admin, action, targetType, targetId, details = '') {
  try {
    await AuditLog.create({
      admin: admin._id,
      adminName: admin.name,
      action,
      targetType,
      targetId: String(targetId),
      details: String(details).slice(0, 300),
    });
  } catch (err) {
    console.error('audit log failed:', err.message);
  }
}

module.exports = { logAction };