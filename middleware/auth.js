const User = require('../models/User');
const { readToken } = require('../utils/token');

async function loadUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;

  try {
    const payload = readToken(token);
    const user = await User.findById(payload.id);
    if (!user || user.deletedAt) return null;

    const version = (user.security && user.security.tokenVersion) || 0;
    if ((payload.v || 0) !== version) return null;

    return user;
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