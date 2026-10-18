const jwt = require('jsonwebtoken');
const User = require('../models/User');

async function loadUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return await User.findById(payload.id);
  } catch {
    return null;
  }
}

async function requireAuth(req, res, next) {
  const user = await loadUser(req);
  if (!user) return res.status(401).json({ error: 'Please log in first' });
  if (user.isBlocked) return res.status(403).json({ error: 'This account is blocked' });
  req.user = user;
  next();
}

async function optionalAuth(req, res, next) {
  const user = await loadUser(req);
  req.user = user && !user.isBlocked ? user : null;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (req.user && req.user.roles.some((r) => roles.includes(r))) return next();
    res.status(403).json({ error: 'You do not have permission to do this' });
  };
}

module.exports = { requireAuth, optionalAuth, requireRole };