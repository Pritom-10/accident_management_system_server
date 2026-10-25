const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

let warned = false;

function allowedOrigins() {
  const fromEnv = [process.env.FRONTEND_URL, ...String(process.env.CORS_ORIGINS || '').split(',')];
  const list = fromEnv.map((s) => String(s || '').trim().replace(/\/+$/, '')).filter(Boolean);
  if (process.env.NODE_ENV !== 'production') list.push('http://localhost:3000', 'http://127.0.0.1:3000');
  return new Set(list);
}

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    const allowed = allowedOrigins();
    if (allowed.size === 0) {
      if (!warned) {
        warned = true;
        console.error('WARNING: FRONTEND_URL is not set, so any website can call this API. Set FRONTEND_URL to your site address.');
      }
      return callback(null, true);
    }

    callback(null, allowed.has(origin.replace(/\/+$/, '')));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
};

const helmetMiddleware = helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } });

function limiter(windowMs, limit, message) {
  return rateLimit({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: message } });
}

const HOUR = 60 * 60 * 1000;

const limits = {
  login: limiter(15 * 60 * 1000, 20, 'Too many login attempts. Please wait a few minutes.'),
  register: limiter(HOUR, 10, 'Too many accounts were made from this connection. Please try again later.'),
  forgot: limiter(HOUR, 8, 'Too many requests. Please try again later.'),
  upload: limiter(HOUR, 30, 'Too many uploads. Please try again later.'),
  report: limiter(HOUR, 12, 'Too many reports from this connection. If it is an emergency, call 999.'),
  flag: limiter(HOUR, 30, 'Too many reports from this connection. Please try again later.'),
  push: limiter(HOUR, 30, 'Too many requests. Please try again later.'),
};

function hasOperator(value, depth = 0) {
  if (depth > 8) return true;
  if (Array.isArray(value)) return value.some((v) => hasOperator(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.keys(value).some((k) => k === '__proto__' || k.startsWith('$') || k.includes('.') || hasOperator(value[k], depth + 1));
  }
  return false;
}

function blockOperators(req, res, next) {
  if (hasOperator(req.body) || hasOperator(req.query)) {
    return res.status(400).json({ error: 'The request contains characters that are not allowed' });
  }
  next();
}

function hideServerErrors(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next();

  const original = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 500 && body && body.error) {
      console.error('server error:', body.error);
      return original({ error: 'Something went wrong. Please try again.' });
    }
    return original(body);
  };
  next();
}

module.exports = { helmetMiddleware, corsOptions, limits, blockOperators, hideServerErrors };