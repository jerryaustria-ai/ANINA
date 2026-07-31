import { Router } from "express";
import { AuditLog } from "../models/AuditLog.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { asyncHandler } from "../utils/http.js";
import { SUPER_ADMIN_ROLE } from "../utils/roles.js";
import { createAuditLog } from "../services/audit.js";

const router = Router();
router.use(requireAuth, requireRole("admin"));
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

router.get(
  "/export",
  requireRole(SUPER_ADMIN_ROLE),
  asyncHandler(async (req, res) => {
    const logs = await AuditLog.find().sort({ createdAt: -1 }).lean();
    await createAuditLog({
      actor: req.user, action: "AUDIT_LOG_EXPORTED",
      description: `Exported ${logs.length} complete audit log records.`,
      entityType: "system", entityId: `audit-export:${Date.now()}`,
      entityLabel: "Complete audit log export", metadata: { rowCount: logs.length },
    });
    const rows = [
      ["Date", "Actor", "Role", "Action", "Description", "Entity Type", "Entity ID", "Entity Label"],
      ...logs.map((log) => [log.createdAt.toISOString(), log.actorName, log.actorRole, log.action,
        log.description, log.entityType, log.entityId, log.entityLabel]),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="anina-complete-audit-log.csv"');
    res.send(`\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\n")}`);
  })
);

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
