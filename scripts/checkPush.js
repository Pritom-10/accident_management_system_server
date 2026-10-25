require('dotenv').config();
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const clean = (v) => String(v || '').trim().replace(/^['"]|['"]$/g, '');
const file = path.resolve('.env');
const pub = clean(process.env.VAPID_PUBLIC_KEY);
const priv = clean(process.env.VAPID_PRIVATE_KEY);
const subject = clean(process.env.VAPID_SUBJECT);

console.log('Looking for .env at:', file, fs.existsSync(file) ? '(found)' : '(NOT FOUND)');
console.log('VAPID_PUBLIC_KEY :', pub ? `found, ${pub.length} characters (should be 87)` : 'MISSING');
console.log('VAPID_PRIVATE_KEY:', priv ? `found, ${priv.length} characters (should be 43)` : 'MISSING');
console.log('VAPID_SUBJECT    :', subject || 'MISSING (a default will be used)');

if (pub && priv) {
  try {
    const mail = /^(mailto:|https:\/\/)/i.test(subject) ? subject : `mailto:${subject || 'admin@example.com'}`;
    webpush.setVapidDetails(mail, pub, priv);
    console.log('\nResult: the keys are valid.');
  } catch (err) {
    console.log('\nResult: the keys are NOT valid:', err.message);
  }
}