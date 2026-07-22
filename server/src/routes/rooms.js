import { Router } from "express";
import { Room } from "../models/Room.js";
import { ClassSession } from "../models/ClassSession.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { asyncHandler, HttpError } from "../utils/http.js";

const router = Router();
router.use(requireAuth);

// Anyone signed in can see rooms (needed to build/read the schedule).
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const filter = req.query.all === "1" ? {} : { active: true };
    const rooms = await Room.find(filter).sort("name");
    res.json({ rooms: rooms.map((r) => r.toPublic()) });
  })
);

// Admin owns rooms + capacity.
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { name, maxCapacity, location, color } = req.body || {};
    if (!name || !maxCapacity) throw new HttpError(400, "name and maxCapacity are required");
    const room = await Room.create({ name, maxCapacity, location, color });
    res.status(201).json({ room: room.toPublic() });
  })
);

router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const room = await Room.findById(req.params.id);
    if (!room) throw new HttpError(404, "Room not found");
    const { name, maxCapacity, location, color, active } = req.body || {};
    if (name !== undefined) room.name = name;
    if (maxCapacity !== undefined) room.maxCapacity = maxCapacity;
    if (location !== undefined) room.location = location;
    if (color !== undefined) room.color = color;
    if (active !== undefined) room.active = active;
    await room.save();
    res.json({ room: room.toPublic() });
  })
);

// Soft-delete: deactivate if any sessions reference it, else remove outright.
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const room = await Room.findById(req.params.id);
    if (!room) throw new HttpError(404, "Room not found");
    const used = await ClassSession.countDocuments({ room: room._id });
    if (used > 0) {
      room.active = false;
      await room.save();
      return res.json({ ok: true, deactivated: true });
    }
    await room.deleteOne();
    res.json({ ok: true, deleted: true });
  })
);

export default router;
