const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const router = express.Router();

const User = require("../models/User");
const BloodRequest = require("../models/BloodRequest");
const Campaign = require("../models/Campaign");
const Donation = require("../models/Donation");
const SosAlert = require("../models/SosAlert");
const NewsPost = require("../models/NewsPost");
const { sendMail } = require("../utils/mailer");
const PushSubscription = require("../models/PushSubscription");
const { requireAuth } = require("../middleware/auth");
const { normalizeBdNumber } = require("../utils/phone");
const { signToken } = require("../utils/token");
const { checkPassword } = require("../utils/password");
const { BLOOD_GROUPS } = require("../utils/blood");
const NewsComment = require("../models/NewsComment");

const str = (v, max = 100) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

router.use(requireAuth);

router.put("/", async (req, res) => {
  try {
    const b = req.body || {};
    const user = req.user;

    const name = str(b.name, 80);
    if (!name) return res.status(400).json({ error: "Name is required" });
    user.name = name;

    const photoUrl = str(b.photoUrl, 500);
    if (photoUrl && !/^(https?:\/\/|\/api\/images\/)/i.test(photoUrl)) {
      return res.status(400).json({ error: "Invalid photo link" });
    }
    user.photoUrl = photoUrl || undefined;

    const blood = str(b.bloodGroup, 5);
    if (blood && !BLOOD_GROUPS.includes(blood))
      return res.status(400).json({ error: "Invalid blood group" });
    user.bloodGroup = blood || undefined;

    const a = b.address || {};
    user.address = {
      division: str(a.division, 50),
      district: str(a.district, 50),
      area: str(a.area, 50),
      details: str(a.details, 200),
    };

    const ec = b.emergencyContact || {};
    const ecPhoneRaw = str(ec.phone, 20);
    let ecPhone = "";
    if (ecPhoneRaw) {
      ecPhone = normalizeBdNumber(ecPhoneRaw);
      if (!ecPhone)
        return res.status(400).json({
          error: "Enter a valid Bangladeshi number for the emergency contact",
        });
    }
    user.emergencyContact = { name: str(ec.name, 80), phone: ecPhone };

    await user.save();
    res.json({ user: user.toPublic() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/password", async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (
      typeof currentPassword !== "string" ||
      typeof newPassword !== "string"
    ) {
      return res
        .status(400)
        .json({ error: "Enter your current and new password" });
    }

    const weak = checkPassword(newPassword, {
      email: req.user.email,
      phone: req.user.phone,
    });
    if (weak) return res.status(400).json({ error: weak });

    const ok = await bcrypt.compare(currentPassword, req.user.passwordHash);
    if (!ok)
      return res.status(400).json({ error: "Your current password is wrong" });

    req.user.passwordHash = await bcrypt.hash(newPassword, 10);
    req.user.security.tokenVersion = (req.user.security.tokenVersion || 0) + 1;
    await req.user.save();

    res.json({ ok: true, token: signToken(req.user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/export", async (req, res) => {
  try {
    const u = req.user;
    const [bloodRequests, offers, campaigns, donations, sos, news] =
      await Promise.all([
        BloodRequest.find({ requester: u._id })
          .select(
            "bloodGroup unitsNeeded unitsDonated hospital location neededBy status createdAt",
          )
          .lean(),
        BloodRequest.find({ "responses.donor": u._id })
          .select("bloodGroup hospital location neededBy status createdAt")
          .lean(),
        Campaign.find({ owner: u._id })
          .select(
            "title story patientName hospital location targetAmount raised spent status createdAt",
          )
          .lean(),
        Donation.find({ donor: u._id })
          .select(
            "receiptNo amount method trxId status createdAt confirmedAt campaign",
          )
          .lean(),
        SosAlert.find({ caller: u._id })
          .select("createdAt status location note")
          .lean(),
        NewsPost.find({ author: u._id })
          .select("title status occurredAt createdAt")
          .lean(),
      ]);

    res.set(
      "Content-Disposition",
      'attachment; filename="sahayota-my-data.json"',
    );
    res.set("Cache-Control", "no-store");
    res.json({
      exportedAt: new Date(),
      profile: u.toPublic(),
      bloodRequests,
      bloodOffers: offers,
      campaigns,
      donations,
      sosAlerts: sos,
      news,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/", async (req, res) => {
  try {
    const u = req.user;
    const password = req.body && req.body.password;

    if (
      typeof password !== "string" ||
      !(await bcrypt.compare(password, u.passwordHash))
    ) {
      return res.status(400).json({ error: "Your password is wrong" });
    }
    if (u.roles.includes("admin")) {
      return res.status(400).json({
        error:
          "An admin account cannot delete itself. Ask another admin to remove the admin role first.",
      });
    }

    const [campaigns, requests] = await Promise.all([
      Campaign.countDocuments({
        owner: u._id,
        status: { $in: ["pending", "active", "completed"] },
      }),
      BloodRequest.countDocuments({
        requester: u._id,
        status: { $in: ["pending", "accepted"] },
      }),
    ]);
    if (campaigns > 0)
      return res.status(400).json({
        error:
          "Close your campaigns first, so donors can still see where the money went.",
      });
    if (requests > 0)
      return res
        .status(400)
        .json({ error: "Cancel your open blood requests first." });

    await Promise.all([
      PushSubscription.deleteMany({ user: u._id }),
      Donation.updateMany(
        { donor: u._id },
        {
          $set: { donorName: "Deleted user" },
          $unset: { donorPhone: 1, donorEmail: 1 },
        },
      ),
      Campaign.updateMany(
        { owner: u._id },
        { $set: { ownerName: "Deleted user" } },
      ),
      BloodRequest.updateMany(
        { requester: u._id },
        { $set: { requesterName: "Deleted user", contactPhone: "" } },
      ),
      BloodRequest.updateMany(
        { "responses.donor": u._id },
        {
          $set: { "responses.$[r].donorName": "Deleted user" },
          $unset: { "responses.$[r].donorPhone": 1 },
        },
        { arrayFilters: [{ "r.donor": u._id }] },
      ),
      SosAlert.updateMany(
        { caller: u._id },
        { $unset: { callerName: 1, callerPhone: 1 } },
      ),
      NewsPost.updateMany(
        { author: u._id },
        { $set: { authorName: "Former writer" } },
      ),
      NewsComment.updateMany(
        { author: u._id },
        { $set: { authorName: "Deleted user", status: "removed" } },
      ),
    ]);

    const randomHash = await bcrypt.hash(
      crypto.randomBytes(24).toString("hex"),
      10,
    );

    await User.updateOne(
      { _id: u._id },
      {
        $set: {
          name: "Deleted user",
          passwordHash: randomHash,
          roles: ["user"],
          deletedAt: new Date(),
          isBlocked: true,
          "volunteer.status": "none",
          "volunteer.availability": "unavailable",
          "donor.isDonor": false,
          "donor.availability": "unavailable",
        },
        $unset: {
          email: 1,
          phone: 1,
          photoUrl: 1,
          bloodGroup: 1,
          address: 1,
          emergencyContact: 1,
          reset: 1,
          emailChange: 1,
          "donor.dateOfBirth": 1,
          "donor.weightKg": 1,
          "donor.lastDonationDate": 1,
          "donor.contactPhone": 1,
          medicalId: 1,
          verification: 1,
          rewards: 1,
          donorRating: 1,
        },
        $inc: { "security.tokenVersion": 1 },
      },
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/email/request", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const next = str(email, 120).toLowerCase();
    const user = req.user;

    if (!EMAIL_RE.test(next))
      return res.status(400).json({ error: "Enter a valid email address" });
    if (
      typeof password !== "string" ||
      !(await bcrypt.compare(password, user.passwordHash))
    ) {
      return res.status(400).json({ error: "Your password is wrong" });
    }
    if (next === user.email && user.emailVerified) {
      return res.status(400).json({ error: "This email is already confirmed" });
    }
    if (await User.exists({ email: next, _id: { $ne: user._id } })) {
      return res
        .status(409)
        .json({ error: "This email is already used by another account" });
    }

    const last = user.emailChange && user.emailChange.requestedAt;
    if (last && Date.now() - new Date(last).getTime() < 60 * 1000) {
      return res
        .status(429)
        .json({ error: "Please wait a minute before asking for a new code" });
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    user.emailChange = {
      email: next,
      otpHash: await bcrypt.hash(otp, 8),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
      requestedAt: new Date(),
    };
    await user.save();

    await sendMail({
      to: next,
      subject: "Confirm your email for Sahayota",
      text: `Your code is ${otp}\n\nIt works for 10 minutes. If you did not ask for this, ignore this email.`,
      html: `<p>Your Sahayota confirmation code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${otp}</p><p>It works for 10 minutes. If you did not ask for this, ignore this email.</p>`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("email request failed:", err.message);
    res
      .status(500)
      .json({ error: "Could not send the code. Please try again later." });
  }
});

router.post("/email/verify", async (req, res) => {
  try {
    const code = str(req.body && req.body.code, 10);
    const user = req.user;
    const change = user.emailChange;
    const bad = { error: "The code is wrong or has expired" };

    if (
      !change ||
      !change.otpHash ||
      !change.expiresAt ||
      change.expiresAt < new Date() ||
      (change.attempts || 0) >= 5
    ) {
      return res.status(400).json(bad);
    }
    if (!/^\d{6}$/.test(code)) return res.status(400).json(bad);

    if (!(await bcrypt.compare(code, change.otpHash))) {
      user.emailChange.attempts = (change.attempts || 0) + 1;
      await user.save();
      return res.status(400).json(bad);
    }

    try {
      user.email = change.email;
      user.emailVerified = true;
      user.emailChange = undefined;
      await user.save();
    } catch (err) {
      if (err.code === 11000)
        return res
          .status(409)
          .json({ error: "This email is already used by another account" });
      throw err;
    }

    res.json({ user: user.toPublic() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
