const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

const MAX_DEVICES = 300;
let state = null;

function configured() {
  if (state !== null) return state;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    state = false;
    return state;
  }

  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', publicKey, privateKey);
    state = true;
  } catch (err) {
    console.error('push is not set up correctly:', err.message);
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

module.exports = { configured, withTimeout, deliver, pushToUsers, pushToNewsFollowers };