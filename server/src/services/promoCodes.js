import { GuestPurchase } from "../models/GuestPurchase.js";
import { PromoCode } from "../models/PromoCode.js";
import { vatInclusiveBreakdown } from "../utils/vat.js";

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const sameId = (left, right) => String(left?._id || left || "") === String(right?._id || right || "");

export function normalizedPromoText(value) {
  return String(value || "").trim().toUpperCase();
}

export function calculatePromoAmounts(originalAmount, promo) {
  const original = roundMoney(originalAmount);
  const rawDiscount = promo.discountType === "percentage"
    ? original * Number(promo.discountValue) / 100
    : Number(promo.discountValue);
  const discountAmount = roundMoney(Math.min(original, Math.max(0, rawDiscount)));
  const finalAmount = roundMoney(Math.max(0, original - discountAmount));
  return { originalAmount: original, discountAmount, ...vatInclusiveBreakdown(finalAmount) };
}

export async function validatePromoForPurchase(purchase, codeText) {
  const code = normalizedPromoText(codeText);
  const promo = await PromoCode.findOne({ code });
  if (!promo) throw Object.assign(new Error("Promo code does not exist."), { status: 404, code: "PROMO_NOT_FOUND" });
  const effectiveStatus = promo.effectiveStatus();
  const statusMessages = {
    draft: "This promo code is not active.",
    inactive: "This promo code is inactive.",
    scheduled: "This promo code is not yet available.",
    expired: "This promo code has expired.",
    usage_limit_reached: "This promo code has reached its usage limit.",
  };
  if (effectiveStatus !== "active") {
    throw Object.assign(new Error(statusMessages[effectiveStatus] || "This promo code is unavailable."), {
      status: 409, code: `PROMO_${effectiveStatus.toUpperCase()}`,
    });
  }

  const originalAmount = Number(purchase.originalAmount || purchase.planSnapshot?.amount || purchase.totalAmount);
  if (originalAmount < Number(promo.minimumPurchaseAmount || 0)) {
    throw Object.assign(new Error("The minimum purchase amount for this promo code has not been met."), {
      status: 409, code: "PROMO_MINIMUM_NOT_MET",
    });
  }

  const directCash = purchase.planSnapshot?.directCash === true;
  const paymentKind = directCash ? "cash" : "online";
  if (promo.applicablePaymentMethod !== "all" && promo.applicablePaymentMethod !== paymentKind) {
    throw Object.assign(new Error("This promo code is not applicable to the selected payment method."), {
      status: 409, code: "PROMO_PAYMENT_NOT_APPLICABLE",
    });
  }

  const classId = purchase.session?.classDefinition?._id || purchase.session?.classDefinition;
  const tierId = purchase.tier?._id || purchase.tier;
  const applicable = promo.applicableTo === "all" ||
    (promo.applicableTo === "regular_cash" && directCash) ||
    (promo.applicableTo === "online_payment" && !directCash) ||
    (promo.applicableTo === "specific_classes" && promo.applicableClassIds.some((id) => sameId(id, classId))) ||
    (["specific_plans", "specific_packages"].includes(promo.applicableTo) &&
      promo.applicableTierIds.some((id) => sameId(id, tierId)));
  if (!applicable) {
    throw Object.assign(new Error("This promo code is not applicable to the selected class, plan, or package."), {
      status: 409, code: "PROMO_SELECTION_NOT_APPLICABLE",
    });
  }

  if (promo.usageLimitPerClient) {
    const uses = await GuestPurchase.countDocuments({
      promoCode: promo._id,
      promoUsageRecordedAt: { $ne: null },
      $or: [
        { email: purchase.email },
        ...(purchase.client ? [{ client: purchase.client }] : []),
      ],
    });
    if (uses >= promo.usageLimitPerClient) {
      throw Object.assign(new Error("You have reached the usage limit for this promo code."), {
        status: 409, code: "PROMO_CLIENT_LIMIT_REACHED",
      });
    }
  }
  return promo;
}

export async function applyPromoToPurchase(purchase, codeText) {
  const promo = await validatePromoForPurchase(purchase, codeText);
  const amounts = calculatePromoAmounts(
    purchase.originalAmount || purchase.planSnapshot?.amount || purchase.totalAmount,
    promo
  );
  purchase.promoCode = promo._id;
  purchase.promoCodeText = promo.code;
  purchase.promoDiscountType = promo.discountType;
  purchase.promoDiscountValue = promo.discountValue;
  purchase.discountAmount = amounts.discountAmount;
  purchase.originalAmount = amounts.originalAmount;
  purchase.subtotal = amounts.subtotal;
  purchase.vatAmount = amounts.vatAmount;
  purchase.totalAmount = amounts.totalAmount;
  await purchase.save();
  return purchase;
}

export async function removePromoFromPurchase(purchase) {
  const originalAmount = Number(purchase.originalAmount || purchase.planSnapshot?.amount || purchase.totalAmount);
  const amounts = vatInclusiveBreakdown(originalAmount);
  purchase.promoCode = null;
  purchase.promoCodeText = "";
  purchase.promoDiscountType = null;
  purchase.promoDiscountValue = null;
  purchase.discountAmount = 0;
  purchase.originalAmount = originalAmount;
  purchase.subtotal = amounts.subtotal;
  purchase.vatAmount = amounts.vatAmount;
  purchase.totalAmount = amounts.totalAmount;
  await purchase.save();
  return purchase;
}

export async function revalidateAppliedPromo(purchase) {
  if (!purchase.promoCodeText) return null;
  return validatePromoForPurchase(purchase, purchase.promoCodeText);
}

export async function recordPromoUsage(purchaseId) {
  const purchase = await GuestPurchase.findOneAndUpdate({
    _id: purchaseId,
    promoCode: { $ne: null },
    promoUsageRecordedAt: null,
    paidAt: { $ne: null },
  }, { $set: { promoUsageRecordedAt: new Date() } }, { new: true });
  if (!purchase) return null;
  await PromoCode.updateOne({ _id: purchase.promoCode }, { $inc: { usageCount: 1 } });
  return purchase;
}
