const crypto = require('crypto');
const { normalizeBdNumber } = require('./phone');

const METHODS = ['bkash', 'nagad', 'rocket', 'bank'];
const LIMITS = { minDonation: 10, maxDonation: 5000000, minTarget: 500, maxTarget: 10000000 };

const text = (v, max = 200) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const longText = (v, max = 5000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function readWhole(v, min, max) {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function readAccount(input) {
  const a = input || {};
  const method = text(a.method, 10);
  if (!METHODS.includes(method)) return { error: 'Choose a valid payment method' };

  const accountName = text(a.accountName, 60);
  if (accountName.length < 2) return { error: 'Enter the name on the account' };

  if (method === 'bank') {
    const bankName = text(a.bankName, 60);
    const number = text(a.number, 30).replace(/\s/g, '');
    if (bankName.length < 2) return { error: 'Enter the bank name' };
    if (!/^[A-Za-z0-9-]{5,30}$/.test(number)) return { error: 'Enter a valid bank account number' };
    return { account: { method, number, accountName, bankName, branch: text(a.branch, 60) } };
  }

  if (method === 'rocket') {
    const digits = String(a.number || '').replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 13) return { error: 'Enter a valid Rocket number' };
    return { account: { method, number: digits, accountName } };
  }

  const phone = normalizeBdNumber(a.number);
  if (!phone) {
    return { error: `Enter a valid ${method === 'bkash' ? 'bKash' : 'Nagad'} number, like 01712345678` };
  }
  return { account: { method, number: `0${phone.slice(3)}`, accountName } };
}

function readTrxId(v) {
  const t = String(v || '').trim().toUpperCase().replace(/\s+/g, '');
  return /^[A-Z0-9-]{6,32}$/.test(t) ? t : null;
}

const receiptNumber = () => `DON-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

const ipHash = (ip) =>
  crypto.createHash('sha256').update(`${ip}|${process.env.JWT_SECRET}`).digest('hex');

module.exports = { METHODS, LIMITS, text, longText, readWhole, readAccount, readTrxId, receiptNumber, ipHash };