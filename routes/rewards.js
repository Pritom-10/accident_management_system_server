const express = require("express");
const router = express.Router();

const User = require("../models/User");
const { requireAuth, optionalAuth } = require("../middleware/auth");
const { statsFor, summarize } = require("../utils/rewards");

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => res.status(500).json({ error: err.message }));

function shortName(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "A member";
  return parts[1]
    ? `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.`
    : parts[0];
}

router.get(
  "/me",
  requireAuth,
  wrap(async (req, res) => {
    const stats = await statsFor([req.user]);
    const s = summarize(req.user, stats.get(String(req.user._id)));
    res.json({
      ...s,
      showOnBoard: Boolean(req.user.rewards && req.user.rewards.showOnBoard),
    });
  }),
);

router.patch(
  "/me",
  requireAuth,
  wrap(async (req, res) => {
    req.user.rewards = {
      showOnBoard: req.body && req.body.showOnBoard === true,
    };
    await req.user.save();
    res.json({ ok: true, showOnBoard: req.user.rewards.showOnBoard });
  }),
);

router.get(
  "/board",
  optionalAuth,
  wrap(async (req, res) => {
    const users = await User.find({
      "rewards.showOnBoard": true,
      isBlocked: { $ne: true },
      deletedAt: null,
    })
      .select(
        "name photoUrl donor.donationCount donorRating verification.status",
      )
      .limit(500)
      .lean();

    const stats = await statsFor(users);

    const rows = users
      .map((u) => {
        const s = summarize(u, stats.get(String(u._id)));
        return {
          id: String(u._id),
          name: shortName(u.name),
          photoUrl: u.photoUrl,
          verified: s.metrics.verified === 1,
          points: s.points,
          badges: s.badges,
          mine: Boolean(req.user && String(req.user._id) === String(u._id)),
        };
      })
      .filter((r) => r.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, 20)
      .map((r, i) => ({ ...r, rank: i + 1 }));

    res.json(rows);
  }),
);

module.exports = router;
