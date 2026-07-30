import { Router } from "express";
import { GuestPurchase } from "../models/GuestPurchase.js";
import { PromoCode } from "../models/PromoCode.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { createAuditLog } from "../services/audit.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
router.use(requireAuth, requireRole("admin"));

const endOfDay = (value) => {
  const date = new Date(value);
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(String(value || ""))) date.setUTCHours(23, 59, 59, 999);
  return date;
};
const bodyForSave = (body) => ({
  code: String(body.code || "").trim().toUpperCase(),
  description: String(body.description || "").trim(),
  discountType: body.discountType,
  discountValue: Number(body.discountValue),
  minimumPurchaseAmount: Number(body.minimumPurchaseAmount || 0),
  startAt: new Date(body.startAt),
  expiresAt: endOfDay(body.expiresAt),
  totalUsageLimit: body.totalUsageLimit ? Number(body.totalUsageLimit) : null,
  usageLimitPerClient: body.usageLimitPerClient ? Number(body.usageLimitPerClient) : null,
  applicableTo: body.applicableTo || "all",
  applicableClassIds: body.applicableClassIds || [],
  applicableTierIds: body.applicableTierIds || [],
  applicablePaymentMethod: body.applicablePaymentMethod || "all",
  status: body.status || "draft",
});
function validateBody(value) {
  if (!value.code) return "Promo Code is required.";
  if (!["fixed", "percentage"].includes(value.discountType)) return "Please select a valid discount type.";
  if (!(value.discountValue > 0)) return "Discount Value must be greater than zero.";
  if (value.discountType === "percentage" && value.discountValue > 100) return "Percentage discount cannot exceed 100%.";
  if (Number.isNaN(value.startAt.getTime()) || Number.isNaN(value.expiresAt.getTime())) return "Start Date and Expiration Date are required.";
  if (value.expiresAt < value.startAt) return "Expiration Date must be on or after the Start Date.";
  if (value.applicableTo === "specific_classes" && !value.applicableClassIds.length) return "Select at least one applicable class.";
  if (["specific_plans", "specific_packages"].includes(value.applicableTo) && !value.applicableTierIds.length) return "Select at least one applicable plan or package.";
  return "";
}

router.get("/", asyncHandler(async (_req, res) => {
  const promoCodes = await PromoCode.find().sort("-createdAt")
    .populate("applicableClassIds", "title")
    .populate("applicableTierIds", "name");
  res.json({ promoCodes: promoCodes.map((promo) => promo.toPublic()) });
}));

router.post("/", asyncHandler(async (req, res) => {
  const data = bodyForSave(req.body);
  const invalid = validateBody(data);
  if (invalid) return res.status(400).json({ error: invalid });
  try {
    const promo = await PromoCode.create({ ...data, createdBy: req.user._id, updatedBy: req.user._id });
    await createAuditLog({
      actor: req.user, action: "PROMO_CODE_CREATED", description: `Created promo code ${promo.code}.`,
      entityType: "promo_code", entityId: promo._id, entityLabel: promo.code, updatedValue: promo,
    });
    res.status(201).json({ promoCode: promo.toPublic() });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "This Promo Code is already in use." });
    throw error;
  }
}));

router.patch("/:id", asyncHandler(async (req, res) => {
  const promo = await PromoCode.findById(req.params.id);
  if (!promo) return res.status(404).json({ error: "Promo code not found." });
  const previous = promo.toObject();
  const data = bodyForSave({ ...promo.toObject(), ...req.body });
  const invalid = validateBody(data);
  if (invalid) return res.status(400).json({ error: invalid });
  Object.assign(promo, data, { updatedBy: req.user._id });
  try {
    await promo.save();
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "This Promo Code is already in use." });
    throw error;
  }
  await createAuditLog({
    actor: req.user, action: "PROMO_CODE_UPDATED", description: `Updated promo code ${promo.code}.`,
    entityType: "promo_code", entityId: promo._id, entityLabel: promo.code,
    previousValue: previous, updatedValue: promo,
  });
  res.json({ promoCode: promo.toPublic() });
}));

router.post("/:id/status", asyncHandler(async (req, res) => {
  const status = req.body.active === true ? "active" : "inactive";
  const promo = await PromoCode.findById(req.params.id);
  if (!promo) return res.status(404).json({ error: "Promo code not found." });
  const previous = promo.status;
  promo.status = status;
  promo.updatedBy = req.user._id;
  await promo.save();
  await createAuditLog({
    actor: req.user, action: status === "active" ? "PROMO_CODE_ACTIVATED" : "PROMO_CODE_DEACTIVATED",
    description: `${status === "active" ? "Activated" : "Deactivated"} promo code ${promo.code}.`,
    entityType: "promo_code", entityId: promo._id, entityLabel: promo.code,
    previousValue: { status: previous }, updatedValue: { status },
  });
  res.json({ promoCode: promo.toPublic() });
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  const promo = await PromoCode.findById(req.params.id);
  if (!promo) return res.status(404).json({ error: "Promo code not found." });
  const hasUsage = promo.usageCount > 0 || await GuestPurchase.exists({
    promoCode: promo._id, promoUsageRecordedAt: { $ne: null },
  });
  if (hasUsage) {
    promo.status = "inactive";
    promo.updatedBy = req.user._id;
    await promo.save();
    await createAuditLog({
      actor: req.user, action: "PROMO_CODE_DELETE_BLOCKED", description: `Deletion blocked for used promo code ${promo.code}; it was deactivated instead.`,
      entityType: "promo_code", entityId: promo._id, entityLabel: promo.code,
      updatedValue: { status: "inactive", deletionBlocked: true },
    });
    return res.status(409).json({
      error: "This promo code has confirmed usage and cannot be deleted. It was deactivated instead.",
      promoCode: promo.toPublic(),
    });
  }
  await createAuditLog({
    actor: req.user, action: "PROMO_CODE_DELETED", description: `Permanently deleted unused promo code ${promo.code}.`,
    entityType: "promo_code", entityId: promo._id, entityLabel: promo.code, previousValue: promo,
  });
  await promo.deleteOne();
  res.json({ message: "Promo code deleted successfully." });
}));

export default router;
