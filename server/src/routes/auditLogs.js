import { Router } from "express";
import { AuditLog } from "../models/AuditLog.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
router.use(requireAuth, requireRole("admin"));
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { from, to, user, role, action, reference, page = "1", limit = "50" } = req.query;
    const filter = {};
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(`${from}T00:00:00`);
      if (to) filter.createdAt.$lte = new Date(`${to}T23:59:59.999`);
    }
    if (user) filter.actorName = { $regex: escapeRegex(user), $options: "i" };
    if (role) filter.actorRole = role;
    if (action) filter.action = action;
    if (reference) {
      const term = escapeRegex(reference);
      filter.$or = [
        { entityId: { $regex: term, $options: "i" } },
        { entityLabel: { $regex: term, $options: "i" } },
        { description: { $regex: term, $options: "i" } },
      ];
    }

    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
    const safePage = Math.max(1, Number(page) || 1);
    const [logs, total, actions] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
      AuditLog.countDocuments(filter),
      AuditLog.distinct("action"),
    ]);
    res.json({
      logs: logs.map((log) => ({ ...log, id: log._id.toString() })),
      total,
      page: safePage,
      pages: Math.max(1, Math.ceil(total / safeLimit)),
      actions: actions.sort(),
    });
  })
);

export default router;
