const User = require('../models/User');
const Donation = require('../models/Donation');
const { pushToUsers, pushToNewsFollowers } = require('./push');
const { donorsFor, eligibleDonorQuery } = require('./blood');

const taka = (n) => `৳${Number(n).toLocaleString('en-IN')}`;
const when = (d) =>
  new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dhaka' });
const idsOf = (rows) => rows.map((r) => r._id);

async function pushSos(alert) {
  const district = alert.location && alert.location.district;
  if (!district) return 0;

  const base = { isBlocked: { $ne: true } };
  if (alert.caller) base._id = { $ne: alert.caller };

  const [volunteers, donors] = await Promise.all([
    User.find({
      ...base,
      roles: 'volunteer',
      'volunteer.status': 'approved',
      'volunteer.availability': 'available',
      'volunteer.serviceArea.district': district,
    })
      .select('_id')
      .lean(),
    User.find({ ...base, 'donor.isDonor': true, 'donor.availability': 'available', 'address.district': district })
      .select('_id')
      .lean(),
  ]);

  const place = [alert.location.area, district].filter(Boolean).join(', ');
  return pushToUsers(
    [...idsOf(volunteers), ...idsOf(donors)],
    'sos',
    {
      title: `SOS near ${place}`,
      body: 'Someone may need help. Open the alert if it is safe for you to go.',
      url: '/sos/nearby',
      tag: 'sos',
      urgent: true,
    },
    { urgency: 'high', ttl: 1800 }
  );
}

async function pushBlood(request) {
  const donors = await User.find({
    ...eligibleDonorQuery(),
    bloodGroup: { $in: donorsFor(request.bloodGroup) },
    'address.district': request.location.district,
    _id: { $ne: request.requester },
  })
    .select('_id')
    .limit(300)
    .lean();

  const units = `${request.unitsNeeded} ${request.unitsNeeded === 1 ? 'bag' : 'bags'}`;
  return pushToUsers(
    idsOf(donors),
    'blood',
    {
      title: `${request.bloodGroup} blood needed in ${request.location.district}`,
      body: `${units} at ${request.hospital.name}, by ${when(request.neededBy)}`,
      url: `/blood/requests/${request._id}`,
      tag: `blood-${request._id}`,
      urgent: new Date(request.neededBy).getTime() - Date.now() < 6 * 3600000,
    },
    { urgency: 'high', ttl: 6 * 3600 }
  );
}

async function pushOffer(request, donorUser) {
  const firstName = String(donorUser.name).split(' ')[0];
  return pushToUsers(
    [request.requester],
    'blood',
    {
      title: 'A donor offered to help',
      body: `${firstName} (${donorUser.bloodGroup}) can donate for your ${request.bloodGroup} request.`,
      url: `/blood/requests/${request._id}`,
      tag: `offer-${request._id}`,
      urgent: true,
    },
    { urgency: 'high', ttl: 3600 }
  );
}

async function pushNews(post) {
  if (post.pushedAt) return 0;

  post.pushedAt = new Date();
  await post.save();

  const parts = [[post.location.area, post.location.district].filter(Boolean).join(', ')];
  if (post.deaths > 0) parts.push(`${post.deaths} dead`);
  if (post.injured > 0) parts.push(`${post.injured} injured`);

  return pushToNewsFollowers(
    post.location.district,
    {
      title: post.title.slice(0, 90),
      body: parts.filter(Boolean).join(' · '),
      url: `/news/${post._id}`,
      tag: `news-${post._id}`,
    },
    { ttl: 6 * 3600 }
  );
}

async function pushDonationConfirmed(campaign, donation) {
  if (!donation.donor) return 0;
  return pushToUsers([donation.donor], 'campaigns', {
    title: 'Your donation was confirmed',
    body: `${taka(donation.amount)} to "${campaign.title}". Thank you.`,
    url: `/donate/receipt/${donation.receiptNo}`,
    tag: `donation-${donation._id}`,
  });
}

async function pushExpenseAdded(campaign, expense) {
  const donors = await Donation.distinct('donor', {
    campaign: campaign._id,
    status: 'confirmed',
    donor: { $exists: true, $ne: null },
  });

  return pushToUsers(donors.slice(0, 300), 'campaigns', {
    title: 'Update on a campaign you helped',
    body: `${taka(expense.amount)} was spent on ${expense.title}.`,
    url: `/donate/${campaign._id}`,
    tag: `expense-${expense._id}`,
  });
}

module.exports = { pushSos, pushBlood, pushOffer, pushNews, pushDonationConfirmed, pushExpenseAdded };