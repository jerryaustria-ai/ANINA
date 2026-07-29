import { Router } from "express";
import { MembershipTier } from "../models/MembershipTier.js";
import { ClassDefinition } from "../models/ClassDefinition.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { asyncHandler, HttpError } from "../utils/http.js";

const router = Router();
router.use(requireAuth);

// Anyone signed in can see purchasable tiers (clients browse them).
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const filter = req.query.all === "1" && req.user.role === "admin" ? {} : { active: true };
    const tiers = await MembershipTier.find(filter).sort("sortOrder name");
    res.json({ tiers: tiers.map((t) => t.toPublic()) });
  })
);

const EDITABLE = ["name", "description", "amount", "currency", "interval", "intervalCount", "benefits",
  "classTags", "eligibleClassCodes", "sessionCount", "unlimitedClasses", "firstTimerOnly", "active", "sortOrder"];
const normalizeCodes = (values) => [...new Set((Array.isArray(values) ? values : [])
  .map((value) => String(value || "").trim().toUpperCase()).filter(Boolean))];

async function validateEligibleCodes(values) {
  const codes = normalizeCodes(values);
  if (!codes.length) throw new HttpError(400, "Select at least one Eligible Class Code.");
  const count = await ClassDefinition.countDocuments({ code: { $in: codes }, active: true });
  if (count !== codes.length) {
    throw new HttpError(400, "One or more Eligible Class Codes do not match an active class.");
  }
  return codes;
}

router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { name, amount } = req.body || {};
    if (!name || amount == null) throw new HttpError(400, "name and amount are required");
    if (req.body.unlimitedClasses !== true &&
        (!Number.isInteger(Number(req.body.sessionCount)) || Number(req.body.sessionCount) < 1)) {
      throw new HttpError(400, "Booking Credits must be at least 1.");
    }
    const eligibleClassCodes = await validateEligibleCodes(req.body.eligibleClassCodes);
    const tier = await MembershipTier.create({
      ...req.body,
      eligibleClassCodes,
      classTags: eligibleClassCodes,
      firstTimerOnly: req.body.firstTimerOnly === true,
    });
    res.status(201).json({ tier: tier.toPublic() });
  })
);

router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const tier = await MembershipTier.findById(req.params.id);
    if (!tier) throw new HttpError(404, "Tier not found");
    const unlimited = req.body.unlimitedClasses ?? tier.unlimitedClasses;
    const credits = req.body.sessionCount ?? tier.sessionCount;
    if (!unlimited && (!Number.isInteger(Number(credits)) || Number(credits) < 1)) {
      throw new HttpError(400, "Booking Credits must be at least 1.");
    }
    const eligibleClassCodes = req.body.eligibleClassCodes !== undefined
      ? await validateEligibleCodes(req.body.eligibleClassCodes)
      : null;
    EDITABLE.forEach((k) => {
      if (req.body[k] !== undefined) {
        tier[k] = k === "firstTimerOnly" ? req.body[k] === true : req.body[k];
      }
    });
    if (eligibleClassCodes) {
      tier.eligibleClassCodes = eligibleClassCodes;
      tier.classTags = eligibleClassCodes;
    }
    await tier.save();
    res.json({ tier: tier.toPublic() });
  })
);

router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const tier = await MembershipTier.findById(req.params.id);
    if (!tier) throw new HttpError(404, "Tier not found");
    // Soft-deactivate so existing memberships keep their tier reference.
    tier.active = false;
    await tier.save();
    res.json({ ok: true, deactivated: true });
  })
);

export default router;
