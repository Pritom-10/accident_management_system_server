const express = require("express");
const router = express.Router();
const HelpOrg = require("../models/HelpOrg");

const str = (v, max = 60) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

router.get("/", async (req, res) => {
  try {
    const filter = { active: true };
    const category = str(req.query.category, 20);
    if (["legal", "counseling", "rehab", "other"].includes(category))
      filter.category = category;

    const district = str(req.query.district, 50);
    if (district) filter.district = { $in: ["All", district] };

    const rows = await HelpOrg.find(filter)
      .sort({ district: -1, name: 1 })
      .limit(200)
      .select("-active -__v")
      .lean();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
