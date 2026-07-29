import { ClassDefinition } from "../models/ClassDefinition.js";
import { ClassSession } from "../models/ClassSession.js";
import { Membership } from "../models/Membership.js";
import { MembershipTier } from "../models/MembershipTier.js";

const normalized = (value) => String(value || "").trim().toLowerCase();

export async function migrateClassIds() {
  const classes = await ClassDefinition.find();
  const rawClasses = await ClassDefinition.collection.find({}).toArray();
  const byTitle = new Map(classes.map((item) => [normalized(item.title), item]));
  const byLegacyCode = new Map(rawClasses
    .filter((item) => item.code)
    .map((item) => [normalized(item.code), item]));

  for (const definition of classes) {
    await ClassSession.updateMany(
      { classDefinition: null, title: definition.title },
      { $set: { classDefinition: definition._id } }
    );
  }

  const tiers = await MembershipTier.find();
  const rawTiers = new Map((await MembershipTier.collection.find({}).toArray())
    .map((item) => [String(item._id), item]));
  for (const tier of tiers) {
    if (!tier.eligibleClassIds?.length) {
      const rawTier = rawTiers.get(String(tier._id));
      const legacyValues = rawTier?.eligibleClassCodes?.length
        ? rawTier.eligibleClassCodes : tier.classTags || [];
      tier.eligibleClassIds = [...new Set(legacyValues.map((value) =>
        byLegacyCode.get(normalized(value))?._id ||
        byTitle.get(normalized(value))?._id
      ).filter(Boolean).map(String))];
      await tier.save();
    }
  }

  const tierMap = new Map(tiers.map((tier) => [String(tier._id), tier]));
  const memberships = await Membership.find({ $or: [
    { validClassIds: { $exists: false } },
    { validClassIds: { $size: 0 } },
  ] });
  for (const membership of memberships) {
    membership.validClassIds = tierMap.get(String(membership.tier))?.eligibleClassIds || [];
    await membership.save();
  }
}
