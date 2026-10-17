
function normalizeBdNumber(input) {
  let n = String(input || '').replace(/\D/g, '');
  if (n.startsWith('0') && !n.startsWith('880')) n = '88' + n;
  else if (n.length === 10 && n.startsWith('1')) n = '880' + n;
  return /^8801[3-9]\d{8}$/.test(n) ? n : null;
}

module.exports = { normalizeBdNumber };