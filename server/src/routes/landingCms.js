import { Router } from "express";
import { randomUUID } from "node:crypto";
import { LandingPageVersion } from "../models/LandingPageVersion.js";
import { SystemSetting } from "../models/SystemSetting.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { createAuditLog } from "../services/audit.js";
import { asyncHandler, HttpError } from "../utils/http.js";
import { SUPER_ADMIN_ROLE } from "../utils/roles.js";

export const publicLandingRouter = Router();
export const superAdminRouter = Router();

const DEFAULT_CONTENT = {
  hero: {
    kicker: "BF Homes · Parañaque",
    headline: "Train once.\\nFor a longer life.",
    description: "Longevity, mobility, strength, and recovery under one roof—guided by thoughtful coaching and built for the long game.",
    image: "/assets/images/hero.jpg",
    primaryLabel: "View Schedule",
    primaryUrl: "/schedule",
    secondaryLabel: "Explore Services",
    secondaryUrl: "#services",
  },
  sections: [
    { key: "about", type: "about", title: "About", visible: true, order: 10, content: {
      kicker: "The ANINA approach",
      headline: "Your body is one system. Your training should be too.",
      text: "ANINA brings assessment, coached movement, progressive strength, and recovery together in one calm space.",
    } },
    { key: "services", type: "services", title: "Services", visible: true, order: 20, content: { items: [] } },
    { key: "featured-plans", type: "plans", title: "Featured plans and packages", visible: false, order: 30, content: { items: [] } },
    { key: "instructors", type: "instructors", title: "Instructors", visible: false, order: 40, content: { items: [] } },
    { key: "testimonials", type: "testimonials", title: "Testimonials", visible: false, order: 50, content: { items: [] } },
    { key: "faq", type: "faq", title: "Frequently Asked Questions", visible: false, order: 60, content: { items: [] } },
    { key: "cta", type: "cta", title: "Call to action", visible: true, order: 70, content: {
      kicker: "Ready when you are",
      headline: "Find a class that fits your next chapter.",
      text: "View the live schedule and request your spot.",
      buttonLabel: "View Schedule",
      buttonUrl: "/schedule",
    } },
  ],
  contact: { email: "hello@aninasanctuary.ph", address: "South Metro Manila, Philippines" },
  socialLinks: {},
  businessHours: "Mon–Sat 6am–9pm · Sun 7am–1pm",
  legalLinks: { terms: "", privacy: "" },
  seo: { title: "ANINA Wellness Sanctuary", description: "Longevity, mobility, strength, and recovery." },
};

function serialize(document) {
  if (!document) return null;
  const value = document.toObject ? document.toObject() : document;
  return { ...value, id: String(value._id) };
}

async function currentDraft(actor) {
  let draft = await LandingPageVersion.findOne({ status: "draft" }).sort("-version");
  if (draft) return draft;
  const latest = await LandingPageVersion.findOne().sort("-version");
  draft = await LandingPageVersion.create({
    ...(latest ? {
      hero: latest.hero, sections: latest.sections, contact: latest.contact,
      socialLinks: latest.socialLinks, businessHours: latest.businessHours,
      legalLinks: latest.legalLinks, seo: latest.seo,
    } : DEFAULT_CONTENT),
    version: (latest?.version || 0) + 1,
    status: "draft",
    createdBy: actor._id,
  });
  return draft;
}

publicLandingRouter.get("/", asyncHandler(async (req, res) => {
  const published = await LandingPageVersion.findOne({ status: "published" }).sort("-publishedAt").lean();
  res.json({ landing: published ? serialize(published) : { ...DEFAULT_CONTENT, version: 0, status: "default" } });
}));

superAdminRouter.use(requireAuth, requireRole(SUPER_ADMIN_ROLE));

superAdminRouter.get("/cms/landing", asyncHandler(async (req, res) => {
  const [draft, published, versions] = await Promise.all([
    currentDraft(req.user),
    LandingPageVersion.findOne({ status: "published" }).sort("-publishedAt"),
    LandingPageVersion.find().sort("-version").limit(30).select("version status createdAt updatedAt publishedAt restoredFrom"),
  ]);
  res.json({ draft: serialize(draft), published: serialize(published), versions: versions.map(serialize) });
}));

superAdminRouter.put("/cms/landing/draft", asyncHandler(async (req, res) => {
  const draft = await currentDraft(req.user);
  const previous = draft.toObject();
  const allowed = ["hero", "sections", "contact", "socialLinks", "businessHours", "legalLinks", "seo"];
  for (const field of allowed) if (req.body?.[field] !== undefined) draft[field] = req.body[field];
  await draft.save();
  await createAuditLog({
    actor: req.user, action: "CMS_DRAFT_UPDATED",
    description: `Updated landing page draft version ${draft.version}.`,
    entityType: "cms", entityId: draft._id, entityLabel: `Landing page v${draft.version}`,
    previousValue: previous, updatedValue: draft,
  });
  res.json({ draft: serialize(draft) });
}));

superAdminRouter.post("/cms/landing/sections", asyncHandler(async (req, res) => {
  const draft = await currentDraft(req.user);
  const type = String(req.body?.type || "").trim();
  if (!type) throw new HttpError(400, "Section type is required");
  draft.sections.push({
    key: randomUUID(), type, title: String(req.body?.title || type),
    visible: req.body?.visible !== false,
    order: draft.sections.length ? Math.max(...draft.sections.map((s) => s.order || 0)) + 10 : 10,
    content: req.body?.content || {},
  });
  await draft.save();
  await createAuditLog({
    actor: req.user, action: "CMS_SECTION_CREATED",
    description: `Created ${type} landing page section.`,
    entityType: "cms", entityId: draft._id, entityLabel: String(req.body?.title || type),
    updatedValue: draft.sections.at(-1),
  });
  res.status(201).json({ draft: serialize(draft) });
}));

superAdminRouter.patch("/cms/landing/sections/:key", asyncHandler(async (req, res) => {
  const draft = await currentDraft(req.user);
  const section = draft.sections.find((item) => item.key === req.params.key);
  if (!section) throw new HttpError(404, "Section not found");
  const previous = section.toObject();
  for (const field of ["title", "visible", "order", "content"]) {
    if (req.body?.[field] !== undefined) section[field] = req.body[field];
  }
  await draft.save();
  await createAuditLog({
    actor: req.user, action: "CMS_SECTION_UPDATED",
    description: `Updated landing page section ${section.title}.`,
    entityType: "cms", entityId: draft._id, entityLabel: section.title,
    previousValue: previous, updatedValue: section,
  });
  res.json({ draft: serialize(draft) });
}));

superAdminRouter.delete("/cms/landing/sections/:key", asyncHandler(async (req, res) => {
  const draft = await currentDraft(req.user);
  const section = draft.sections.find((item) => item.key === req.params.key);
  if (!section) throw new HttpError(404, "Section not found");
  draft.sections = draft.sections.filter((item) => item.key !== req.params.key);
  await draft.save();
  await createAuditLog({
    actor: req.user, action: "CMS_SECTION_REMOVED",
    description: `Removed landing page section ${section.title} from the draft.`,
    entityType: "cms", entityId: draft._id, entityLabel: section.title,
    previousValue: section,
  });
  res.json({ draft: serialize(draft) });
}));

superAdminRouter.post("/cms/landing/publish", asyncHandler(async (req, res) => {
  const draft = await currentDraft(req.user);
  await LandingPageVersion.updateMany({ status: "published" }, { $set: { status: "archived" } });
  draft.status = "published";
  draft.publishedBy = req.user._id;
  draft.publishedAt = new Date();
  await draft.save();
  await createAuditLog({
    actor: req.user, action: "CMS_PUBLISHED",
    description: `Published landing page version ${draft.version}.`,
    entityType: "cms", entityId: draft._id, entityLabel: `Landing page v${draft.version}`,
    updatedValue: draft,
  });
  res.json({ published: serialize(draft) });
}));

superAdminRouter.post("/cms/landing/unpublish", asyncHandler(async (req, res) => {
  const published = await LandingPageVersion.findOne({ status: "published" });
  if (!published) throw new HttpError(404, "No published landing page");
  published.status = "unpublished";
  await published.save();
  await createAuditLog({
    actor: req.user, action: "CMS_UNPUBLISHED",
    description: `Unpublished landing page version ${published.version}.`,
    entityType: "cms", entityId: published._id, entityLabel: `Landing page v${published.version}`,
    previousValue: { status: "published" }, updatedValue: { status: "unpublished" },
  });
  res.json({ ok: true });
}));

superAdminRouter.post("/cms/landing/restore/:version", asyncHandler(async (req, res) => {
  const source = await LandingPageVersion.findOne({ version: Number(req.params.version) });
  if (!source) throw new HttpError(404, "Version not found");
  await LandingPageVersion.deleteMany({ status: "draft" });
  const latest = await LandingPageVersion.findOne().sort("-version");
  const draft = await LandingPageVersion.create({
    version: (latest?.version || 0) + 1, status: "draft", createdBy: req.user._id,
    restoredFrom: source.version, hero: source.hero, sections: source.sections,
    contact: source.contact, socialLinks: source.socialLinks,
    businessHours: source.businessHours, legalLinks: source.legalLinks, seo: source.seo,
  });
  await createAuditLog({
    actor: req.user, action: "CMS_VERSION_RESTORED",
    description: `Restored landing page version ${source.version} as draft ${draft.version}.`,
    entityType: "cms", entityId: draft._id, entityLabel: `Landing page v${draft.version}`,
    metadata: { restoredFrom: source.version },
  });
  res.json({ draft: serialize(draft) });
}));

const ALLOWED_SETTINGS = new Map([
  ["business_name", "general"], ["timezone", "general"], ["support_email", "general"],
  ["payment_provider_enabled", "payments"], ["cash_payments_enabled", "payments"],
  ["email_notifications_enabled", "email"], ["notification_poll_seconds", "notifications"],
]);

superAdminRouter.get("/settings", asyncHandler(async (req, res) => {
  const settings = await SystemSetting.find().sort("category key").lean();
  res.json({ settings });
}));

superAdminRouter.put("/settings/:key", asyncHandler(async (req, res) => {
  const category = ALLOWED_SETTINGS.get(req.params.key);
  if (!category) throw new HttpError(400, "Unsupported system setting");
  const previous = await SystemSetting.findOne({ key: req.params.key }).lean();
  const setting = await SystemSetting.findOneAndUpdate(
    { key: req.params.key },
    { $set: { category, value: req.body?.value, updatedBy: req.user._id } },
    { new: true, upsert: true }
  );
  await createAuditLog({
    actor: req.user, action: "SYSTEM_SETTING_UPDATED",
    description: `Updated system setting ${req.params.key}.`,
    entityType: "system", entityId: setting._id, entityLabel: req.params.key,
    previousValue: previous, updatedValue: setting,
  });
  res.json({ setting });
}));

