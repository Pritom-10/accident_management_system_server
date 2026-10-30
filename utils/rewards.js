const Donation = require("../models/Donation");
const SosAlert = require("../models/SosAlert");

const POINTS = { donation: 100, arrived: 20, campaign: 10, verified: 50 };

const BADGES = [
  { id: "first_drop", metric: "donations", need: 1 },
  { id: "life_saver", metric: "donations", need: 5 },
  { id: "hero", metric: "donations", need: 10 },
  { id: "first_responder", metric: "arrived", need: 1 },
  { id: "rescuer", metric: "arrived", need: 5 },
  { id: "generous", metric: "campaign", need: 3 },
  { id: "trusted", metric: "verified", need: 1 },
  { id: "loved", metric: "loved", need: 1 },
];

async function statsFor(users) {
  const ids = users.map((u) => u._id);
  if (ids.length === 0) return new Map();

  const [camp, sos] = await Promise.all([
    Donation.aggregate([
      { $match: { donor: { $in: ids }, status: "confirmed" } },
      { $group: { _id: "$donor", n: { $sum: 1 } } },
    ]),
    SosAlert.aggregate([
      { $match: { "responders.user": { $in: ids } } },
      { $unwind: "$responders" },
      {
        $match: {
          "responders.user": { $in: ids },
          "responders.status": "arrived",
        },
      },
      { $group: { _id: "$responders.user", n: { $sum: 1 } } },
    ]),
  ]);

  const map = new Map(
    ids.map((id) => [String(id), { campaign: 0, arrived: 0 }]),
  );
  camp.forEach(
    (r) => map.get(String(r._id)) && (map.get(String(r._id)).campaign = r.n),
  );
  sos.forEach(
    (r) => map.get(String(r._id)) && (map.get(String(r._id)).arrived = r.n),
  );
  return map;
}

function summarize(user, extra = {}) {
  const rating = user.donorRating || {};
  const count = rating.count || 0;
  const avg = count ? rating.sum / count : 0;

  const metrics = {
    donations: (user.donor && user.donor.donationCount) || 0,
    arrived: extra.arrived || 0,
    campaign: extra.campaign || 0,
    verified:
      user.verification && user.verification.status === "approved" ? 1 : 0,
    loved: count >= 3 && avg >= 4.5 ? 1 : 0,
  };

  const earned = BADGES.filter((b) => metrics[b.metric] >= b.need).map(
    (b) => b.id,
  );
  const progress = BADGES.filter((b) => metrics[b.metric] < b.need).map(
    (b) => ({
      id: b.id,
      have: metrics[b.metric],
      need: b.need,
    }),
  );

  const points =
    metrics.donations * POINTS.donation +
    metrics.arrived * POINTS.arrived +
    metrics.campaign * POINTS.campaign +
    metrics.verified * POINTS.verified;

  return {
    points,
    metrics,
    badges: earned,
    progress,
    rating: { avg: Math.round(avg * 10) / 10, count },
  };
}

module.exports = { POINTS, statsFor, summarize };
