import { Router } from "express";
import { ClassDefinition } from "../models/ClassDefinition.js";
import { Room } from "../models/Room.js";
import { ClassSession } from "../models/ClassSession.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { createAuditLog } from "../services/audit.js";
import { asyncHandler, HttpError } from "../utils/http.js";

const router = Router();
router.use(requireAuth);
const populate = (query) => query.populate("defaultRoom", "name maxCapacity location color active");

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
    const titles = await ClassSession.distinct("title", { title: { $ne: "" } });
    const existing = new Set((await ClassDefinition.find().select("title")).map((item) => item.title.toLowerCase()));
    const missing = titles.filter((title) => !existing.has(String(title).toLowerCase()));
    if (missing.length) {
      await ClassDefinition.insertMany(missing.map((title) => ({
        title, description: "Imported from existing schedules.",
        type: "group", defaultCapacity: 8, defaultMinToRun: 1,
      })));
    }
    res.json({ imported: missing.length });
  })
);

async function validate(body, existing = null) {
  const title = String(body.title ?? existing?.title ?? "").trim();
  const type = body.type ?? existing?.type ?? "group";
  const hasRoomValue = Object.prototype.hasOwnProperty.call(body, "defaultRoom");
  const roomId = hasRoomValue ? body.defaultRoom || null : existing?.defaultRoom || null;
  let room = null;
  if (roomId) {
    room = await Room.findOne({ _id: roomId, active: true });
    if (!room) throw new HttpError(400, "The selected default room is unavailable.");
  }
  const requestedCapacity = Number(body.defaultCapacity ?? existing?.defaultCapacity ?? 8);
  const capacity = type === "private" ? 1 : room ? room.maxCapacity : requestedCapacity;
  const requestedMinimum = Number(body.defaultMinToRun ?? existing?.defaultMinToRun ?? 1);
  const minimum = type === "private" ? 1 : requestedMinimum;
  if (!title) throw new HttpError(400, "Class title is required.");
  if (!["group", "private"].includes(type)) throw new HttpError(400, "Class type is invalid.");
  if (!Number.isInteger(capacity) || capacity < 1) throw new HttpError(400, "Capacity must be greater than zero.");
  if (!Number.isInteger(minimum) || minimum < 1 || minimum > capacity) {
    throw new HttpError(400, "Minimum participants must be between 1 and the class capacity.");
  }
  return { title, type, capacity, minimum, roomId };
}

router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const values = await validate(req.body || {});
    const duplicate = await ClassDefinition.exists({ title: { $regex: `^${values.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } });
    if (duplicate) throw new HttpError(409, "A class title with this name already exists.");
    const item = await ClassDefinition.create({
      title: values.title,
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
    item.title = values.title;
    item.description = req.body.description !== undefined ? String(req.body.description).trim() : item.description;
    item.type = values.type;
    item.defaultRoom = values.roomId;
    item.defaultCapacity = values.capacity;
    item.defaultMinToRun = values.minimum;
    if (req.body.active !== undefined) item.active = !!req.body.active;
    await item.save();
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
