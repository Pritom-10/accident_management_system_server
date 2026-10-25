const jwt = require('jsonwebtoken');

function signToken(user) {
  const version = (user.security && user.security.tokenVersion) || 0;
  return jwt.sign({ id: user._id, v: version }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' });
}

function readToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
}

module.exports = { signToken, readToken };