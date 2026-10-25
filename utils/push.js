const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

const MAX_DEVICES = 300;
let state = null;

const clean = (v) => String(v || '').trim().replace(/^['"]|['"]$/g, '');
const publicKey = () => clean(process.env.VAPID_PUBLIC_KEY);

function configured() {
  if (state !== null) return state;

  const pub = publicKey();
  const priv = clean(process.env.VAPID_PRIVATE_KEY);
  let subject = clean(process.env.VAPID_SUBJECT) || 'mailto:admin@example.com';
  if (!/^(mailto:|https:\/\/)/i.test(subject)) subject = `mailto:${subject}`;

  if (!pub || !priv) {
    console.error(`push is off: ${!pub ? 'VAPID_PUBLIC_KEY' : 'VAPID_PRIVATE_KEY'} is missing`);
    state = false;
    return state;
  }

  try {
    webpush.setVapidDetails(subject, pub, priv);
    state = true;
  } catch (err) {
    console.error('push is off, the keys are not valid:', err.message);
    state = false;
  }
  return state;
}

const withTimeout = (promise, ms = 4000) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(0), ms))]);

async function deliver(subs, payload, { ttl = 3600, urgency = 'normal' } = {}) {
  if (!configured() || subs.length === 0) return 0;

  const body = JSON.stringify(payload);
  let sent = 0;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } },
          body,
          { TTL: ttl, urgency, timeout: 5000 }
        );
        sent += 1;
        await PushSubscription.updateOne({ _id: s._id }, { $set: { lastSentAt: new Date(), failures: 0 } });
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: s._id });
        } else {
          await PushSubscription.updateOne({ _id: s._id }, { $inc: { failures: 1 } });
        }
      }
    })
  );

  await PushSubscription.deleteMany({ _id: { $in: subs.map((s) => s._id) }, failures: { $gte: 8 } });
  return sent;
}

async function pushToUsers(userIds, prefKey, payload, options) {
  const ids = [...new Set(userIds.map(String))];
  if (ids.length === 0) return 0;

  const subs = await PushSubscription.find({ user: { $in: ids }, [`prefs.${prefKey}`]: true })
    .limit(MAX_DEVICES)
    .lean();
  return deliver(subs, payload, options);
}

async function pushToNewsFollowers(district, payload, options) {
  const filter = { 'prefs.news': true, $or: district ? [{ district: '' }, { district }] : [{ district: '' }] };
  const subs = await PushSubscription.find(filter).limit(MAX_DEVICES).lean();
  return deliver(subs, payload, options);
}

module.exports = { configured, publicKey, withTimeout, deliver, pushToUsers, pushToNewsFollowers };