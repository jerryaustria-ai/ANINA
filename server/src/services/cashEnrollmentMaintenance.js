import { GuestPurchase } from "../models/GuestPurchase.js";

// Remove a legacy empty placeholder that incorrectly participated in the
// sparse unique token index. Real hashed confirmation tokens are untouched.
export async function cleanupBlankCashConfirmationTokens() {
  const result = await GuestPurchase.collection.updateMany(
    { $or: [
      { cashConfirmationTokenHash: "" },
      { cashConfirmationTokenHash: { $type: 10 } },
    ] },
    { $unset: { cashConfirmationTokenHash: "" } }
  );
  return result.modifiedCount || 0;
}
