import { ClassDefinition } from "../models/ClassDefinition.js";
import { ClassSession } from "../models/ClassSession.js";
import { Membership } from "../models/Membership.js";
import { MembershipTier } from "../models/MembershipTier.js";

const normalizeCode = (value) => String(value || "").trim().toUpperCase();
const baseCode = (value) => String(value || "").trim().toUpperCase()
  .replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "CLASS";

export async function migrateClassCodes() {
  const definitions = await ClassDefinition.find().sort({ createdAt: 1 });
  const used = new Set(definitions.map((item) => normalizeCode(item.code)).filter(Boolean));

  for (const definition of definitions) {
    if (!normalizeCode(definition.code)) {
      const base = baseCode(definition.title);
      let code = base;
      let suffix = 2;
      while (used.has(code)) code = `${base}-${suffix++}`;
      await ClassDefinition.updateOne({ _id: definition._id }, { $set: { code } });
      definition.code = code;
      used.add(code);
    }
    await ClassSession.updateMany(
      { classDefinition: definition._id, classCode: { $ne: definition.code } },
      { $set: { classCode: definition.code } }
    );
    await ClassSession.updateMany(
      { classDefinition: null, title: definition.title },
      { $set: { classDefinition: definition._id, classCode: definition.code } }
    );
  }

  const activeCodes = definitions.map((item) => normalizeCode(item.code)).filter(Boolean);
  const titleToCode = new Map(definitions.map((item) => [
    String(item.title || "").trim().toLowerCase(), normalizeCode(item.code),
  ]));
  const tiers = await MembershipTier.find();
  for (const tier of tiers) {
    if (!tier.eligibleClassCodes?.length) {
      const migrated = (tier.classTags || [])
        .map((tag) => titleToCode.get(String(tag || "").trim().toLowerCase()) || normalizeCode(tag))
        .filter((code) => activeCodes.includes(code));
      tier.eligibleClassCodes = [...new Set(migrated.length ? migrated : activeCodes)];
      tier.classTags = tier.eligibleClassCodes;
      await tier.save();
    }
  }

  const tierMap = new Map(tiers.map((tier) => [String(tier._id), tier]));
  const memberships = await Membership.find({ $or: [
    { validClassCodes: { $exists: false } },
    { validClassCodes: { $size: 0 } },
  ] });
  for (const membership of memberships) {
    const tier = tierMap.get(String(membership.tier));
    const fallback = (membership.validClassTags || [])
      .map((tag) => titleToCode.get(String(tag || "").trim().toLowerCase()) || normalizeCode(tag))
      .filter((code) => activeCodes.includes(code));
    membership.validClassCodes = [...new Set(tier?.eligibleClassCodes?.length
      ? tier.eligibleClassCodes : fallback)];
    await membership.save();
  }
}
