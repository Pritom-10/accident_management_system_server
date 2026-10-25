const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', '12345678', '123456789', '1234567890',
  '11111111', '00000000', '88888888', 'qwertyui', 'qwerty123', 'qwertyuiop', 'abcd1234', 'abc12345',
  'iloveyou', 'admin123', 'welcome1', 'letmein1', 'sahayota', 'bangladesh', 'dhaka1234', 'monkey123',
]);

function checkPassword(password, { email = '', phone = '' } = {}) {
  if (typeof password !== 'string') return 'Enter a password';
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (Buffer.byteLength(password, 'utf8') > 72) return 'Password is too long. Use 72 characters or fewer';

  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) return 'This password is too easy to guess. Choose another one';

  const local = String(email || '').split('@')[0].toLowerCase();
  if (local.length >= 4 && lower.includes(local)) return 'Do not use your email name inside your password';

  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length >= 8 && lower.includes(digits.slice(-8))) return 'Do not use your mobile number inside your password';

  return null;
}

module.exports = { checkPassword };