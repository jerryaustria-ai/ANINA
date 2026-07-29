import { Router } from "express";
import { ClassDefinition } from "../models/ClassDefinition.js";
import { Room } from "../models/Room.js";
import { ClassSession } from "../models/ClassSession.js";
import { Booking } from "../models/Booking.js";
import { Membership } from "../models/Membership.js";
import { MembershipTier } from "../models/MembershipTier.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { createAuditLog } from "../services/audit.js";
import { asyncHandler, HttpError } from "../utils/http.js";

const router = Router();
router.use(requireAuth);
const populate = (query) => query.populate("defaultRoom", "name maxCapacity location color active");
const normalizeCode = (value) => String(value || "").trim().toUpperCase();
const codeFromTitle = (value) => String(value || "")
  .trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "CLASS";

async function uniqueGeneratedCode(title) {
  const base = codeFromTitle(title);
  let code = base;
  let suffix = 2;
  while (await ClassDefinition.exists({ code })) code = `${base}-${suffix++}`;
  return code;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const filter = req.user.role === "admin" && req.query.all === "1" ? {} : { active: true };
    const classes = await populate(ClassDefinition.find(filter).sort("title"));
    res.json({ classes: classes.map((item) => item.toPublic()) });
  })
);

router.post(
  "/import-existing",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const withoutCodes = await ClassDefinition.find({
      $or: [{ code: { $exists: false } }, { code: "" }, { code: null }],
    });
    for (const item of withoutCodes) {
      item.code = await uniqueGeneratedCode(item.title);
      await item.save();
      await ClassSession.updateMany(
        { $or: [{ classDefinition: item._id }, { classDefinition: null, title: item.title }] },
        { $set: { classDefinition: item._id, classCode: item.code } }
      );
    }
    const titles = await ClassSession.distinct("title", { title: { $ne: "" } });
    const existing = new Set((await ClassDefinition.find().select("title")).map((item) => item.title.toLowerCase()));
    const missing = titles.filter((title) => !existing.has(String(title).toLowerCase()));
    if (missing.length) {
      for (const title of missing) {
        await ClassDefinition.create({
          title, code: await uniqueGeneratedCode(title),
          description: "Imported from existing schedules.",
          type: "group", defaultCapacity: 8, defaultMinToRun: 1,
        });
      }
    }
    res.json({ imported: missing.length, codesBackfilled: withoutCodes.length });
  })
);

async function validate(body, existing = null) {
  const title = String(body.title ?? existing?.title ?? "").trim();
  const code = normalizeCode(body.code ?? existing?.code ?? "");
  const type = body.type ?? existing?.type ?? "group";
  const hasRoomValue = Object.prototype.hasOwnProperty.call(body, "defaultRoom");
  const roomId = hasRoomValue ? body.defaultRoom || null : existing?.defaultRoom || null;
  let room = null;
  if (roomId) {
    room = await Room.findOne({ _id: roomId, active: true });
    if (!room) throw new HttpError(400, "The selected default room is unavailable.");
  }
  const requestedCapacity = Number(body.defaultCapacity ?? existing?.defaultCapacity ?? 8);
  const capacity = type === "private" ? 1 : requestedCapacity;
  const requestedMinimum = Number(body.defaultMinToRun ?? existing?.defaultMinToRun ?? 1);
  const minimum = type === "private" ? 1 : requestedMinimum;
  if (!title) throw new HttpError(400, "Class title is required.");
  if (!code) throw new HttpError(400, "Class Code is required.");
  if (!["group", "private"].includes(type)) throw new HttpError(400, "Class type is invalid.");
  if (!Number.isInteger(capacity) || capacity < 1) throw new HttpError(400, "Capacity must be greater than zero.");
  if (room && capacity > room.maxCapacity) {
    throw new HttpError(400, `Maximum capacity cannot exceed the selected room capacity of ${room.maxCapacity}.`);
  }
  if (!Number.isInteger(minimum) || minimum < 1 || minimum > capacity) {
    throw new HttpError(400, "Minimum participants must be between 1 and the class capacity.");
  }
  return { title, code, type, capacity, minimum, roomId };
}

router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const values = await validate(req.body || {});
    const duplicate = await ClassDefinition.exists({ title: { $regex: `^${values.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } });
    if (duplicate) throw new HttpError(409, "A class title with this name already exists.");
    if (await ClassDefinition.exists({ code: values.code })) {
      throw new HttpError(409, "This Class Code is already in use.");
    }
    const item = await ClassDefinition.create({
      title: values.title,
      code: values.code,
      description: String(req.body.description || "").trim(),
      type: values.type,
      defaultRoom: values.roomId,
      defaultCapacity: values.capacity,
      defaultMinToRun: values.minimum,
      active: req.body.active !== false,
    });
    await createAuditLog({
      actor: req.user, action: "CLASS_TITLE_CREATED",
      description: `Created official class title ${item.title}.`,
      entityType: "class", entityId: item._id, entityLabel: item.title,
      updatedValue: item,
    });
    res.status(201).json({ classDefinition: (await populate(ClassDefinition.findById(item._id))).toPublic() });
  })
);

router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const item = await ClassDefinition.findById(req.params.id);
    if (!item) throw new HttpError(404, "Class title not found.");
    const previous = item.toObject({ depopulate: true });
    const values = await validate(req.body || {}, item);
    const duplicate = await ClassDefinition.exists({
      _id: { $ne: item._id },
      title: { $regex: `^${values.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
    });
    if (duplicate) throw new HttpError(409, "A class title with this name already exists.");
    if (await ClassDefinition.exists({ _id: { $ne: item._id }, code: values.code })) {
      throw new HttpError(409, "This Class Code is already in use.");
    }
    const oldCode = normalizeCode(item.code);
    const codeUpdated = oldCode !== values.code;
    const codeChanged = !!oldCode && codeUpdated;
    if (codeChanged) {
      const linkedSessionFilter = {
        $or: [{ classDefinition: item._id }, { classDefinition: null, title: item.title }],
      };
      const sessionIds = await ClassSession.find(linkedSessionFilter).distinct("_id");
      const [hasBookings, hasTier, hasMembership] = await Promise.all([
        sessionIds.length ? Booking.exists({ session: { $in: sessionIds } }) : false,
        MembershipTier.exists({ active: true, eligibleClassCodes: oldCode }),
        Membership.exists({ status: "active", validClassCodes: oldCode }),
      ]);
      if ((hasBookings || hasTier || hasMembership) && req.body.confirmCodeChange !== true) {
        throw new HttpError(
          409,
          "This Class Code is linked to existing bookings or active plans. Confirm the change to continue."
        );
      }
    }
    item.title = values.title;
    item.code = values.code;
    item.description = req.body.description !== undefined ? String(req.body.description).trim() : item.description;
    item.type = values.type;
    item.defaultRoom = values.roomId;
    item.defaultCapacity = values.capacity;
    item.defaultMinToRun = values.minimum;
    if (req.body.active !== undefined) item.active = !!req.body.active;
    await item.save();
    await ClassSession.updateMany({
      $or: [{ classDefinition: item._id }, { classDefinition: null, title: previous.title }],
    }, {
      $set: { classDefinition: item._id, classCode: values.code, title: values.title },
    });
    if (codeUpdated) {
      await Promise.all([
        MembershipTier.updateMany({ eligibleClassCodes: oldCode }, {
          $set: { "eligibleClassCodes.$[entry]": values.code },
        }, { arrayFilters: [{ entry: oldCode }] }),
        Membership.updateMany({ validClassCodes: oldCode }, {
          $set: { "validClassCodes.$[entry]": values.code },
        }, { arrayFilters: [{ entry: oldCode }] }),
      ]);
    }
    await createAuditLog({
      actor: req.user, action: "CLASS_TITLE_UPDATED",
      description: `Updated official class title ${item.title}.`,
      entityType: "class", entityId: item._id, entityLabel: item.title,
      previousValue: previous, updatedValue: item,
    });
    res.json({ classDefinition: (await populate(ClassDefinition.findById(item._id))).toPublic() });
  })
);

router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const item = await ClassDefinition.findById(req.params.id);
    if (!item) throw new HttpError(404, "Class title not found.");
    item.active = false;
    await item.save();
    res.json({ ok: true, deactivated: true });
  })
);

export default router;
