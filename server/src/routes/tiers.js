import { Router } from "express";
import { MembershipTier } from "../models/MembershipTier.js";
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

const EDITABLE = ["name", "description", "amount", "currency", "interval", "intervalCount", "benefits", "active", "sortOrder"];

router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { name, amount } = req.body || {};
    if (!name || amount == null) throw new HttpError(400, "name and amount are required");
    const tier = await MembershipTier.create(req.body);
    res.status(201).json({ tier: tier.toPublic() });
  })
);

router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const tier = await MembershipTier.findById(req.params.id);
    if (!tier) throw new HttpError(404, "Tier not found");
    EDITABLE.forEach((k) => { if (req.body[k] !== undefined) tier[k] = req.body[k]; });
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
