const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const User = require("../models/User");
const NewsPost = require("../models/NewsPost");
const Campaign = require("../models/Campaign");
const SosAlert = require("../models/SosAlert");
const { activeSince } = require("../utils/sos");
const { withTimeout } = require("../utils/push");
const { pushNews } = require("../utils/pushNotify");
const AccidentReport = require("../models/AccidentReport");
const UnidentifiedPatient = require("../models/UnidentifiedPatient");
const BloodRequest = require("../models/BloodRequest");
const BlockedPhone = require("../models/BlockedPhone");
const AuditLog = require("../models/AuditLog");
const { requireAuth, requireRole } = require("../middleware/auth");
const { normalizeBdNumber } = require("../utils/phone");
const { logAction } = require("../utils/audit");
const NewsComment = require("../models/NewsComment");
const NewsReaction = require("../models/NewsReaction");
const { findSimilar } = require("../utils/newsSimilarity");
const { applyCounts } = require("../utils/newsUpdates");
const Donation = require("../models/Donation");
const Hospital = require("../models/Hospital");
const HospitalAdmission = require("../models/HospitalAdmission");
const Image = require("../models/Image");
const HelpOrg = require("../models/HelpOrg");

router.use(requireAuth, requireRole("admin"));

router.param("id", (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id))
    return res.status(404).json({ error: "Not found" });
  next();
});

const str = (v, max = 300) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const phoneKey = (p) =>
  normalizeBdNumber(p) || String(p || "").replace(/\D/g, "");
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => res.status(500).json({ error: err.message }));

const PUBLIC_STATUSES = ["verified", "rescue_in_progress", "cleared"];
const ASSIGNABLE_ROLES = [
  "donor",
  "volunteer",
  "hospital",
  "bloodbank",
  "ngo",
  "journalist",
  "admin",
];

router.get(
  "/stats",
  wrap(async (req, res) => {
    const [
      pendingReports,
      flaggedReports,
      pendingVolunteers,
      pendingPatients,
      newsPosts,
      newsUpdates,
      pendingCampaigns,
      flaggedCampaigns,
      activeSos,
      reportedComments,
      openDisputes,
      users,
    ] = await Promise.all([
      AccidentReport.countDocuments({ status: "pending" }),
      AccidentReport.countDocuments({
        status: { $in: PUBLIC_STATUSES },
        "flags.0": { $exists: true },
      }),
      User.countDocuments({ "volunteer.status": "pending" }),
      UnidentifiedPatient.countDocuments({ status: "pending" }),
      NewsPost.countDocuments({ status: "pending" }),
      NewsPost.countDocuments({
        status: "published",
        "updates.approved": false,
      }),
      Campaign.countDocuments({ status: "pending" }),
      Campaign.countDocuments({
        status: { $in: ["active", "completed"] },
        "flags.0": { $exists: true },
      }),
      SosAlert.countDocuments({
        status: "active",
        createdAt: { $gte: activeSince() },
      }),
      NewsComment.countDocuments({
        status: { $in: ["visible", "hidden"] },
        reportCount: { $gt: 0 },
        reviewedAt: null,
      }),
      Donation.countDocuments({ "dispute.status": "open" }),
      User.countDocuments(),
    ]);

    res.json({
      pendingReports,
      flaggedReports,
      pendingVolunteers,
      pendingPatients,
      pendingNews: newsPosts + newsUpdates,
      pendingCampaigns,
      flaggedCampaigns,
      activeSos,
      reportedComments,
      openDisputes,
      users,
    });
  }),
);

const REPORT_FILTERS = {
  pending: ["pending"],
  verified: PUBLIC_STATUSES,
  rejected: ["rejected"],
};

router.get(
  "/news",
  wrap(async (req, res) => {
    const wanted = req.query.status;
    const filter =
      wanted === "updates"
        ? { status: "published", "updates.approved": false }
        : {
            status: ["pending", "published", "rejected"].includes(wanted)
              ? wanted
              : "pending",
          };

    const list = await NewsPost.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    if (
      wanted !== "updates" &&
      ["pending", "published"].includes(filter.status) &&
      list.length > 0
    ) {
      const DAY_MS = 24 * 60 * 60 * 1000;
      const times = list
        .map((p) => new Date(p.occurredAt).getTime())
        .filter(Number.isFinite);

      if (times.length > 0) {
        const pool = await NewsPost.find({
          status: { $in: ["pending", "published"] },
          occurredAt: {
            $gte: new Date(Math.min(...times) - DAY_MS),
            $lte: new Date(Math.max(...times) + DAY_MS),
          },
        })
          .select("title status occurredAt road location")
          .limit(1000)
          .lean();

        list.forEach((p) => {
          p.similar = findSimilar(p, pool);
        });
      }
    }

    res.json(list);
  }),
);

router.post(
  "/news/:id/merge",
  wrap(async (req, res) => {
    const dupId = req.body && req.body.duplicateId;
    if (!mongoose.isValidObjectId(dupId) || String(dupId) === req.params.id) {
      return res
        .status(400)
        .json({ error: "Choose a different story to merge" });
    }

    const [primary, dup] = await Promise.all([
      NewsPost.findById(req.params.id),
      NewsPost.findById(dupId),
    ]);
    if (!primary || !dup) return res.status(404).json({ error: "Not found" });
    if (
      ["merged", "rejected"].includes(primary.status) ||
      ["merged"].includes(dup.status)
    ) {
      return res.status(400).json({ error: "These stories cannot be merged" });
    }
    if (dup.status === "published" && primary.status !== "published") {
      return res.status(400).json({
        error:
          "Keep the published story and merge the waiting one into it instead",
      });
    }

    primary.photos = [...new Set([...primary.photos, ...dup.photos])].slice(
      0,
      4,
    );
    primary.deaths = Math.max(primary.deaths || 0, dup.deaths || 0);
    primary.injured = Math.max(primary.injured || 0, dup.injured || 0);
    primary.vehicleTypes = [
      ...new Set([...primary.vehicleTypes, ...dup.vehicleTypes]),
    ];
    if (!primary.road && dup.road) primary.road = dup.road;
    if (!primary.videoUrl && dup.videoUrl) primary.videoUrl = dup.videoUrl;

    const seen = new Set([
      `${primary.sourceName || ""}|${primary.sourceUrl || ""}`,
    ]);
    const sources = [...(primary.extraSources || [])];
    sources.forEach((s) => seen.add(`${s.name || ""}|${s.url || ""}`));

    const addSource = (name, url) => {
      if (!name && !url) return;
      const key = `${name || ""}|${url || ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      sources.push({ name, url });
    };
    addSource(dup.sourceName, dup.sourceUrl);
    (dup.extraSources || []).forEach((s) => addSource(s.name, s.url));
    primary.extraSources = sources.slice(0, 8);

    (dup.updates || []).forEach((u) => {
      primary.updates.push({
        kind: u.kind,
        text: u.text,
        at: u.at,
        deaths: u.deaths,
        injured: u.injured,
        approved: u.approved,
        author: u.author,
        authorName: u.authorName,
      });
    });
    primary.refreshUpdates();

    if (!primary.pushedAt && dup.pushedAt) primary.pushedAt = dup.pushedAt;

    dup.status = "merged";
    dup.mergedInto = primary._id;
    dup.isVerified = false;

    await primary.save();
    await dup.save();

    await NewsComment.updateMany(
      { news: dup._id },
      { $set: { news: primary._id } },
    );
    const reactions = await NewsReaction.find({ post: dup._id }).lean();
    for (const r of reactions) {
      await NewsReaction.updateOne(
        { post: primary._id, user: r.user },
        { $setOnInsert: { type: r.type } },
        { upsert: true },
      );
    }
    await NewsReaction.deleteMany({ post: dup._id });

    await logAction(
      req.user,
      "news.merge",
      "NewsPost",
      primary._id,
      `"${dup.title}" merged into "${primary.title}"`,
    );
    res.json({ ok: true });
  }),
);

router.patch(
  "/news/:id/updates/:updateId/approve",
  wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.updateId))
      return res.status(404).json({ error: "Not found" });

    const post = await NewsPost.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Not found" });

    const update = post.updates.id(req.params.updateId);
    if (!update) return res.status(404).json({ error: "Not found" });
    if (update.approved)
      return res.status(400).json({ error: "This update is already live" });

    update.approved = true;
    applyCounts(post, update);
    post.refreshUpdates();
    await post.save();

    await logAction(
      req.user,
      "news.update-approve",
      "NewsPost",
      post._id,
      post.title,
    );
    res.json({ ok: true });
  }),
);

router.patch(
  "/news/:id/approve",
  wrap(async (req, res) => {
    const post = await NewsPost.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Not found" });

    post.status = "published";
    post.isVerified = req.body?.verified === true;
    post.rejectionReason = undefined;
    post.publishedAt = post.publishedAt || new Date();
    await post.save();

    await logAction(
      req.user,
      "news.approve",
      "NewsPost",
      post._id,
      `${post.title} (${post.isVerified ? "verified" : "unverified"})`,
    );

    let alerted = 0;
    if (req.body?.breaking === true) {
      try {
        alerted = await withTimeout(pushNews(post), 4000);
      } catch (err) {
        console.error("news push failed:", err.message);
      }
    }

    res.json({ ok: true, alerted });
  }),
);

router.post(
  "/news/:id/alert",
  wrap(async (req, res) => {
    const post = await NewsPost.findById(req.params.id);
    if (!post || post.status !== "published")
      return res
        .status(404)
        .json({ error: "Only a published post can be sent as an alert" });
    if (post.pushedAt)
      return res
        .status(400)
        .json({ error: "An alert was already sent for this post" });

    const alerted = await withTimeout(pushNews(post), 4000);
    await logAction(req.user, "news.alert", "NewsPost", post._id, post.title);
    res.json({ ok: true, alerted });
  }),
);

router.patch(
  "/news/:id/verify",
  wrap(async (req, res) => {
    const verified = req.body?.verified === true;
    const post = await NewsPost.findByIdAndUpdate(
      req.params.id,
      { isVerified: verified },
      { new: true },
    );
    if (!post) return res.status(404).json({ error: "Not found" });

    await logAction(
      req.user,
      verified ? "news.verify" : "news.unverify",
      "NewsPost",
      post._id,
      post.title,
    );
    res.json({ ok: true });
  }),
);

router.patch(
  "/news/:id/reject",
  wrap(async (req, res) => {
    const post = await NewsPost.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Not found" });

    post.status = "rejected";
    post.isVerified = false;
    post.rejectionReason = str(req.body?.reason) || "Not approved";
    await post.save();

    await logAction(
      req.user,
      "news.reject",
      "NewsPost",
      post._id,
      `${post.title}: ${post.rejectionReason}`,
    );
    res.json({ ok: true });
  }),
);

router.get(
  "/reports",
  wrap(async (req, res) => {
    let filter = { status: "pending" };
    if (req.query.status === "verified")
      filter = { status: { $in: PUBLIC_STATUSES } };
    else if (req.query.status === "rejected") filter = { status: "rejected" };
    else if (req.query.status === "flagged") {
      filter = {
        status: { $in: PUBLIC_STATUSES },
        "flags.0": { $exists: true },
      };
    }

    const reports = await AccidentReport.find(filter)
      .select("-flags.ipHash")
      .sort({ createdAt: -1 })
      .limit(200);
    res.json(reports);
  }),
);

router.patch(
  "/reports/:id/status",
  wrap(async (req, res) => {
    const status = req.body?.status;
    if (!["rescue_in_progress", "cleared"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const wasPublic = PUBLIC_STATUSES.includes(report.status);
    report.status = status;
    report.rejectionReason = undefined;
    if (!wasPublic) {
      report.verifiedBy = req.user._id;
      report.verifiedAt = new Date();
    }
    await report.save();

    await logAction(
      req.user,
      wasPublic ? "report.status" : "report.approve",
      "AccidentReport",
      report.caseId,
      status,
    );
    res.json(report);
  }),
);

router.patch(
  "/reports/:id/reject",
  wrap(async (req, res) => {
    const { reason, fake, blockPhone } = req.body || {};

    const report = await AccidentReport.findById(req.params.id);
    if (!report) return res.status(404).json({ error: "Not found" });

    report.status = "rejected";
    report.rejectionReason =
      str(reason) || (fake === true ? "Fake information" : "Rejected by admin");
    await report.save();

    let blocked = false;
    if (blockPhone === true) {
      const key = phoneKey(report.reporterPhone);
      if (key) {
        await BlockedPhone.updateOne(
          { phone: key },
          {
            $setOnInsert: {
              reason: report.rejectionReason,
              blockedBy: req.user._id,
            },
          },
          { upsert: true },
        );
        blocked = true;
      }
    }

    await logAction(
      req.user,
      fake === true ? "report.fake" : "report.reject",
      "AccidentReport",
      report.caseId,
      `${report.rejectionReason}${blocked ? " (number blocked)" : ""}`,
    );
    res.json({ ok: true, blocked });
  }),
);

router.patch(
  "/reports/:id/clear-flags",
  wrap(async (req, res) => {
    const report = await AccidentReport.findByIdAndUpdate(
      req.params.id,
      { flags: [] },
      { new: true },
    );
    if (!report) return res.status(404).json({ error: "Not found" });

    await logAction(
      req.user,
      "report.clear-flags",
      "AccidentReport",
      report.caseId,
    );
    res.json({ ok: true });
  }),
);

router.get(
  "/volunteers",
  wrap(async (req, res) => {
    const status = ["pending", "approved", "rejected"].includes(
      req.query.status,
    )
      ? req.query.status
      : "pending";
    const list = await User.find({ "volunteer.status": status })
      .select("-passwordHash -reset -security")
      .sort({ updatedAt: -1 })
      .limit(200);
    res.json(list);
  }),
);

router.patch(
  "/volunteers/:id/approve",
  wrap(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "Not found" });

    if (!user.roles.includes("volunteer")) user.roles.push("volunteer");
    user.volunteer.status = "approved";
    user.volunteer.rejectionReason = undefined;
    await user.save();

    await logAction(req.user, "volunteer.approve", "User", user._id, user.name);
    res.json({ ok: true });
  }),
);

router.patch(
  "/volunteers/:id/reject",
  wrap(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "Not found" });

    user.roles = user.roles.filter((r) => r !== "volunteer");
    user.volunteer.status = "rejected";
    user.volunteer.rejectionReason = str(req.body?.reason) || "Not approved";
    user.volunteer.availability = "unavailable";
    await user.save();

    await logAction(
      req.user,
      "volunteer.reject",
      "User",
      user._id,
      `${user.name}: ${user.volunteer.rejectionReason}`,
    );
    res.json({ ok: true });
  }),
);

router.get(
  "/patients",
  wrap(async (req, res) => {
    const status = ["pending", "verified", "rejected"].includes(
      req.query.status,
    )
      ? req.query.status
      : "pending";
    const list = await UnidentifiedPatient.find({ status })
      .populate("admittingHospital", "name")
      .sort({ createdAt: -1 })
      .limit(200);
    res.json(list);
  }),
);

router.patch(
  "/patients/:id/verify",
  wrap(async (req, res) => {
    const patient = await UnidentifiedPatient.findByIdAndUpdate(
      req.params.id,
      { status: "verified", verifiedBy: req.user._id },
      { new: true },
    );
    if (!patient) return res.status(404).json({ error: "Not found" });

    await logAction(
      req.user,
      "patient.verify",
      "UnidentifiedPatient",
      patient._id,
    );
    res.json({ ok: true });
  }),
);

router.patch(
  "/patients/:id/reject",
  wrap(async (req, res) => {
    const patient = await UnidentifiedPatient.findByIdAndUpdate(
      req.params.id,
      { status: "rejected", verifiedBy: req.user._id },
      { new: true },
    );
    if (!patient) return res.status(404).json({ error: "Not found" });

    await logAction(
      req.user,
      "patient.reject",
      "UnidentifiedPatient",
      patient._id,
    );
    res.json({ ok: true });
  }),
);

router.get(
  "/users",
  wrap(async (req, res) => {
    const q = str(req.query.q, 60);
    const filter = {};
    if (q) {
      const re = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ name: re }, { email: re }, { phone: re }];
    }
    const users = await User.find(filter)
      .select("-passwordHash -reset -security")
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(users);
  }),
);

router.patch(
  "/users/:id/block",
  wrap(async (req, res) => {
    if (String(req.user._id) === req.params.id) {
      return res.status(400).json({ error: "You cannot block yourself" });
    }
    const blocked = req.body?.blocked === true;

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isBlocked: blocked },
      { new: true },
    );
    if (!user) return res.status(404).json({ error: "Not found" });

    await logAction(
      req.user,
      blocked ? "user.block" : "user.unblock",
      "User",
      user._id,
      user.name,
    );
    res.json({ ok: true });
  }),
);

router.patch(
  "/users/:id/roles",
  wrap(async (req, res) => {
    if (String(req.user._id) === req.params.id) {
      return res
        .status(400)
        .json({ error: "You cannot change your own roles" });
    }
    if (!Array.isArray(req.body?.roles))
      return res.status(400).json({ error: "roles must be a list" });

    const wanted = req.body.roles.filter((r) => ASSIGNABLE_ROLES.includes(r));

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "Not found" });

    user.roles = ["user", ...new Set(wanted)]; // everyone always stays a "user"
    if (user.roles.includes("volunteer")) user.volunteer.status = "approved";
    else if (user.volunteer.status === "approved")
      user.volunteer.status = "none";
    await user.save();

    await logAction(
      req.user,
      "user.roles",
      "User",
      user._id,
      `${user.name}: ${user.roles.join(", ")}`,
    );
    res.json({ ok: true });
  }),
);

router.get(
  "/blocked-phones",
  wrap(async (req, res) => {
    res.json(await BlockedPhone.find().sort({ createdAt: -1 }).limit(200));
  }),
);

router.delete(
  "/blocked-phones/:id",
  wrap(async (req, res) => {
    const item = await BlockedPhone.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });

    await logAction(req.user, "phone.unblock", "BlockedPhone", item.phone);
    res.json({ ok: true });
  }),
);

router.get(
  "/blood",
  wrap(async (req, res) => {
    const filter =
      req.query.status === "closed"
        ? { status: { $in: ["completed", "cancelled"] } }
        : { status: { $in: ["pending", "accepted"] } };
    res.json(
      await BloodRequest.find(filter).sort({ createdAt: -1 }).limit(200),
    );
  }),
);

router.patch(
  "/blood/:id/cancel",
  wrap(async (req, res) => {
    const request = await BloodRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: "Not found" });

    request.status = "cancelled";
    request.cancelledReason = str(req.body?.reason, 200) || "Removed by admin";
    await request.save();

    await logAction(
      req.user,
      "blood.cancel",
      "BloodRequest",
      request._id,
      `${request.bloodGroup} at ${request.hospital.name}: ${request.cancelledReason}`,
    );
    res.json({ ok: true });
  }),
);

router.delete(
  "/blood/:id",
  wrap(async (req, res) => {
    const request = await BloodRequest.findByIdAndDelete(req.params.id);
    if (!request) return res.status(404).json({ error: "Not found" });

    await logAction(
      req.user,
      "blood.delete",
      "BloodRequest",
      request._id,
      `${request.bloodGroup} at ${request.hospital.name}`,
    );
    res.json({ ok: true });
  }),
);

router.get(
  "/campaigns",
  wrap(async (req, res) => {
    let filter = { status: "pending" };
    if (req.query.status === "active")
      filter = { status: { $in: ["active", "completed"] } };
    else if (req.query.status === "flagged") {
      filter = {
        status: { $in: ["active", "completed"] },
        "flags.0": { $exists: true },
      };
    } else if (req.query.status === "closed")
      filter = { status: { $in: ["closed", "rejected"] } };

    res.json(
      await Campaign.find(filter)
        .select("-flags.ipHash")
        .sort({ createdAt: -1 })
        .limit(200),
    );
  }),
);

router.patch(
  "/campaigns/:id/approve",
  wrap(async (req, res) => {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Not found" });
    if (!["pending", "rejected"].includes(campaign.status)) {
      return res
        .status(400)
        .json({ error: "Only a waiting or rejected campaign can be approved" });
    }

    campaign.status = "active";
    campaign.isVerified = true;
    campaign.verifiedAt = new Date();
    campaign.rejectionReason = undefined;
    await campaign.save();

    await logAction(
      req.user,
      "campaign.approve",
      "Campaign",
      campaign._id,
      campaign.title,
    );
    res.json({ ok: true });
  }),
);

router.patch(
  "/campaigns/:id/reject",
  wrap(async (req, res) => {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Not found" });

    campaign.status = "rejected";
    campaign.isVerified = false;
    campaign.rejectionReason = str(req.body?.reason) || "Not approved";
    await campaign.save();

    await logAction(
      req.user,
      "campaign.reject",
      "Campaign",
      campaign._id,
      `${campaign.title}: ${campaign.rejectionReason}`,
    );
    res.json({ ok: true });
  }),
);

router.patch(
  "/campaigns/:id/clear-flags",
  wrap(async (req, res) => {
    const campaign = await Campaign.findByIdAndUpdate(
      req.params.id,
      { flags: [] },
      { new: true },
    );
    if (!campaign) return res.status(404).json({ error: "Not found" });

    await logAction(
      req.user,
      "campaign.clear-flags",
      "Campaign",
      campaign._id,
      campaign.title,
    );
    res.json({ ok: true });
  }),
);

router.get(
  "/sos",
  wrap(async (req, res) => {
    const filter =
      req.query.status === "closed"
        ? { status: { $ne: "active" } }
        : { status: "active" };
    const list = await SosAlert.find(filter)
      .select("-ipHash")
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(list);
  }),
);

router.patch(
  "/sos/:id/resolve",
  wrap(async (req, res) => {
    const alert = await SosAlert.findById(req.params.id);
    if (!alert) return res.status(404).json({ error: "Not found" });

    alert.status = "resolved";
    alert.resolvedAt = new Date();
    await alert.save();

    await logAction(
      req.user,
      "sos.resolve",
      "SosAlert",
      alert._id,
      [alert.location?.area, alert.location?.district]
        .filter(Boolean)
        .join(", "),
    );
    res.json({ ok: true });
  }),
);

router.patch(
  "/sos/:id/false-alarm",
  wrap(async (req, res) => {
    const alert = await SosAlert.findById(req.params.id);
    if (!alert) return res.status(404).json({ error: "Not found" });

    alert.status = "false_alarm";
    alert.resolvedAt = new Date();
    await alert.save();

    let blocked = false;
    if (req.body?.blockPhone === true && alert.callerPhone) {
      const key = phoneKey(alert.callerPhone);
      if (key) {
        await BlockedPhone.updateOne(
          { phone: key },
          {
            $setOnInsert: {
              reason: "False SOS alert",
              blockedBy: req.user._id,
            },
          },
          { upsert: true },
        );
        blocked = true;
      }
    }

    await logAction(
      req.user,
      "sos.false-alarm",
      "SosAlert",
      alert._id,
      blocked ? "number blocked" : "",
    );
    res.json({ ok: true, blocked });
  }),
);

router.get(
  "/comments",
  wrap(async (req, res) => {
    let filter;
    if (req.query.status === "hidden") filter = { status: "hidden" };
    else if (req.query.status === "recent") filter = { status: "visible" };
    else
      filter = {
        status: { $in: ["visible", "hidden"] },
        reportCount: { $gt: 0 },
        reviewedAt: null,
      };

    const rows = await NewsComment.find(filter)
      .populate("news", "title")
      .sort({ reportCount: -1, createdAt: -1 })
      .limit(100)
      .lean();

    res.json(
      rows.map((c) => ({
        _id: c._id,
        author: c.author,
        authorName: c.authorName,
        text: c.text,
        status: c.status,
        reportCount: c.reportCount,
        reasons: (c.reports || [])
          .map((r) => r.reason)
          .filter(Boolean)
          .slice(0, 6),
        createdAt: c.createdAt,
        news: c.news ? { _id: c.news._id, title: c.news.title } : null,
      })),
    );
  }),
);

router.patch(
  "/comments/:id/hide",
  wrap(async (req, res) => {
    const comment = await NewsComment.findById(req.params.id);
    if (!comment) return res.status(404).json({ error: "Not found" });

    comment.status = "hidden";
    comment.reviewedAt = new Date();
    await comment.save();

    await logAction(
      req.user,
      "comment.hide",
      "NewsComment",
      comment._id,
      comment.authorName,
    );
    res.json({ ok: true });
  }),
);

router.patch(
  "/comments/:id/restore",
  wrap(async (req, res) => {
    const comment = await NewsComment.findById(req.params.id);
    if (!comment) return res.status(404).json({ error: "Not found" });

    comment.status = "visible";
    comment.reviewedAt = new Date();
    await comment.save();

    await logAction(
      req.user,
      "comment.restore",
      "NewsComment",
      comment._id,
      comment.authorName,
    );
    res.json({ ok: true });
  }),
);

router.patch(
  "/comments/:id/remove",
  wrap(async (req, res) => {
    const comment = await NewsComment.findById(req.params.id);
    if (!comment) return res.status(404).json({ error: "Not found" });

    comment.status = "removed";
    comment.reviewedAt = new Date();
    await comment.save();

    await logAction(
      req.user,
      "comment.remove",
      "NewsComment",
      comment._id,
      comment.authorName,
    );
    res.json({ ok: true });
  }),
);

router.get(
  "/disputes",
  wrap(async (req, res) => {
    const filter =
      req.query.status === "closed"
        ? { "dispute.status": { $in: ["resolved", "refunded"] } }
        : { "dispute.status": "open" };

    const rows = await Donation.find(filter)
      .populate("campaign", "title ownerName")
      .sort({ "dispute.openedAt": -1 })
      .limit(100)
      .lean();

    res.json(
      rows.map((d) => ({
        _id: d._id,
        receiptNo: d.receiptNo,
        amount: d.amount,
        method: d.method,
        trxId: d.trxId,
        status: d.status,
        donorName: d.donorName,
        donorPhone: d.donorPhone,
        donorEmail: d.donorEmail,
        dispute: d.dispute,
        campaign: d.campaign
          ? {
              _id: d.campaign._id,
              title: d.campaign.title,
              ownerName: d.campaign.ownerName,
            }
          : null,
      })),
    );
  }),
);

const HOSPITAL_TYPES = [
  "hospital",
  "blood_bank",
  "ambulance",
  "fire_service",
  "police",
  "other",
];

function readHospital(b = {}) {
  const name = str(b.name, 120);
  if (name.length < 3) return { error: "Enter the name" };
  if (!HOSPITAL_TYPES.includes(b.type)) return { error: "Choose a type" };

  const phone = str(b.phone, 30);
  if (phone.length < 3) return { error: "Enter a phone number" };

  const division = str(b.division, 50);
  const district = str(b.district, 50);
  if (!division || !district)
    return { error: "Choose a division and a district" };

  const address = str(b.address, 200);
  if (address.length < 3) return { error: "Enter the address" };

  return { data: { name, type: b.type, phone, division, district, address } };
}

async function trimManagerRoles(userIds) {
  for (const id of userIds) {
    if (await Hospital.exists({ managers: id })) continue;
    await User.updateOne(
      { _id: id },
      { $pull: { roles: { $in: ["hospital", "bloodbank"] } } },
    );
  }
}

router.get(
  "/hospitals",
  wrap(async (req, res) => {
    const q = str(req.query.q, 60);
    const filter = {};
    if (q) {
      const re = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ name: re }, { district: re }, { address: re }];
    }

    const list = await Hospital.find(filter)
      .populate("managers", "name email")
      .sort({ isPinned: -1, name: 1 })
      .limit(300)
      .lean();

    res.json(
      list.map((h) => ({
        _id: h._id,
        name: h.name,
        type: h.type,
        address: h.address,
        phone: h.phone,
        division: h.division,
        district: h.district,
        isPinned: h.isPinned,
        updatedAt: h.statusUpdatedAt || null,
        managers: (h.managers || []).map((m) => ({
          _id: m._id,
          name: m.name,
          email: m.email,
        })),
      })),
    );
  }),
);

router.post(
  "/hospitals",
  wrap(async (req, res) => {
    const { data, error } = readHospital(req.body);
    if (error) return res.status(400).json({ error });

    const hospital = await Hospital.create(data);
    await logAction(
      req.user,
      "hospital.create",
      "Hospital",
      hospital._id,
      hospital.name,
    );
    res.status(201).json({ id: hospital._id });
  }),
);

router.put(
  "/hospitals/:id",
  wrap(async (req, res) => {
    const { data, error } = readHospital(req.body);
    if (error) return res.status(400).json({ error });

    const hospital = await Hospital.findById(req.params.id);
    if (!hospital) return res.status(404).json({ error: "Not found" });

    Object.assign(hospital, data);
    await hospital.save();

    await logAction(
      req.user,
      "hospital.update",
      "Hospital",
      hospital._id,
      hospital.name,
    );
    res.json({ ok: true });
  }),
);

router.delete(
  "/hospitals/:id",
  wrap(async (req, res) => {
    const hospital = await Hospital.findById(req.params.id);
    if (!hospital) return res.status(404).json({ error: "Not found" });
    if (hospital.isPinned)
      return res
        .status(400)
        .json({ error: "The national emergency number cannot be deleted" });

    const [admissions, patients] = await Promise.all([
      HospitalAdmission.countDocuments({ hospital: hospital._id }),
      UnidentifiedPatient.countDocuments({ admittingHospital: hospital._id }),
    ]);
    if (admissions + patients > 0) {
      return res.status(400).json({
        error:
          "This place has patient records, so it cannot be deleted. Keep it listed.",
      });
    }

    const managers = hospital.managers.slice();
    await hospital.deleteOne();
    await trimManagerRoles(managers);

    await logAction(
      req.user,
      "hospital.delete",
      "Hospital",
      hospital._id,
      hospital.name,
    );
    res.json({ ok: true });
  }),
);

router.patch(
  "/hospitals/:id/managers",
  wrap(async (req, res) => {
    const hospital = await Hospital.findById(req.params.id);
    if (!hospital) return res.status(404).json({ error: "Not found" });

    const action = req.body?.action;
    if (!["add", "remove"].includes(action))
      return res.status(400).json({ error: "Invalid action" });

    const email = str(req.body?.email, 120).toLowerCase();
    const user = email ? await User.findOne({ email }) : null;
    if (!user)
      return res
        .status(404)
        .json({ error: "No account was found with this email" });

    if (action === "add") {
      if (user.isBlocked)
        return res.status(400).json({ error: "This account is blocked" });

      hospital.managers.addToSet(user._id);
      const role = hospital.type === "blood_bank" ? "bloodbank" : "hospital";
      if (!user.roles.includes(role)) user.roles.push(role);

      await hospital.save();
      await user.save();
    } else {
      hospital.managers.pull(user._id);
      await hospital.save();
      await trimManagerRoles([user._id]);
    }

    await logAction(
      req.user,
      `hospital.manager-${action}`,
      "Hospital",
      hospital._id,
      `${hospital.name}: ${user.name}`,
    );
    res.json({ ok: true });
  }),
);

router.get(
  "/verifications",
  wrap(async (req, res) => {
    const rows = await User.find({ "verification.status": "pending" })
      .select("name email phone verification")
      .sort({ "verification.submittedAt": 1 })
      .limit(100)
      .lean();

    res.json(
      rows.map((u) => ({
        _id: u._id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        docType: u.verification.docType,
        images: u.verification.images,
        submittedAt: u.verification.submittedAt,
      })),
    );
  }),
);

async function decideVerification(req, res, approved) {
  const user = await User.findById(req.params.id);
  if (!user || !user.verification || user.verification.status !== "pending") {
    return res.status(404).json({ error: "Nothing to review" });
  }

  const ids = (user.verification.images || [])
    .map((u) => String(u).split("/").pop())
    .filter((i) => /^[a-f0-9]{24}$/.test(i));
  if (ids.length)
    await Image.deleteMany({
      _id: { $in: ids },
      isPrivate: true,
      uploadedBy: user._id,
    });

  user.verification.status = approved ? "approved" : "rejected";
  user.verification.reason = approved
    ? undefined
    : str(req.body?.reason) || "Not approved";
  user.verification.reviewedAt = new Date();
  user.verification.images = [];
  await user.save();

  await logAction(
    req.user,
    approved ? "verify.approve" : "verify.reject",
    "User",
    user._id,
    user.name,
  );
  res.json({ ok: true });
}

router.patch(
  "/verifications/:id/approve",
  wrap((req, res) => decideVerification(req, res, true)),
);
router.patch(
  "/verifications/:id/reject",
  wrap((req, res) => decideVerification(req, res, false)),
);

const HELP_CATS = ["legal", "counseling", "rehab", "other"];

function readOrg(b = {}) {
  const name = str(b.name, 120);
  if (name.length < 3) return { error: "Enter the name" };
  if (!HELP_CATS.includes(b.category)) return { error: "Choose a type" };

  const phone = str(b.phone, 30);
  if (phone.length < 3) return { error: "Enter a phone number" };

  const website = str(b.website, 200);
  if (website && !/^https?:\/\//i.test(website))
    return { error: "The website must start with http:// or https://" };

  return {
    data: {
      name,
      category: b.category,
      description: str(b.description, 400),
      phone,
      website: website || undefined,
      address: str(b.address, 200),
      division: str(b.division, 50) || "All",
      district: str(b.district, 50) || "All",
      free: b.free !== false,
      active: b.active !== false,
      verifiedAt: new Date(),
    },
  };
}

router.get(
  "/help-orgs",
  wrap(async (req, res) => {
    res.json(await HelpOrg.find().sort({ createdAt: -1 }).limit(300).lean());
  }),
);

router.post(
  "/help-orgs",
  wrap(async (req, res) => {
    const { data, error } = readOrg(req.body);
    if (error) return res.status(400).json({ error });
    const org = await HelpOrg.create(data);
    await logAction(req.user, "helporg.create", "HelpOrg", org._id, org.name);
    res.status(201).json({ id: org._id });
  }),
);

router.put(
  "/help-orgs/:id",
  wrap(async (req, res) => {
    const { data, error } = readOrg(req.body);
    if (error) return res.status(400).json({ error });
    const org = await HelpOrg.findByIdAndUpdate(req.params.id, data, {
      new: true,
    });
    if (!org) return res.status(404).json({ error: "Not found" });
    await logAction(req.user, "helporg.update", "HelpOrg", org._id, org.name);
    res.json({ ok: true });
  }),
);

router.delete(
  "/help-orgs/:id",
  wrap(async (req, res) => {
    const org = await HelpOrg.findByIdAndDelete(req.params.id);
    if (!org) return res.status(404).json({ error: "Not found" });
    await logAction(req.user, "helporg.delete", "HelpOrg", org._id, org.name);
    res.json({ ok: true });
  }),
);

router.get(
  "/logs",
  wrap(async (req, res) => {
    res.json(await AuditLog.find().sort({ createdAt: -1 }).limit(100));
  }),
);

module.exports = router;
