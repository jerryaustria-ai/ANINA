import { Router } from "express";
import { Booking } from "../models/Booking.js";
import { ClassSession } from "../models/ClassSession.js";
import { User } from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { asyncHandler, HttpError } from "../utils/http.js";
import { createAuditLog } from "../services/audit.js";
import { isSuperAdmin } from "../utils/roles.js";

const router = Router();
router.use(requireAuth, requireRole("admin"));

const ACTIVE_BOOKINGS = ["pending", "accepted", "waitlisted"];

function dateRange(query) {
  const now = new Date();
  const from = query.from ? new Date(query.from) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = query.to ? new Date(query.to) : new Date(now.getFullYear(), now.getMonth() + 1, 1);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    throw new HttpError(400, "A valid report date range is required.");
  }
  return { from, to };
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function reportRows(bookings) {
  return bookings.filter((booking) => booking.session && booking.client).map((booking) => ({
    reference: booking.purchase?.referenceId || booking._id.toString(),
    client: booking.client.name,
    email: booking.client.email,
    service: booking.session.title,
    instructor: booking.session.instructor?.name || "",
    room: booking.session.room?.name || "",
    start: booking.session.startAt.toISOString(),
    end: booking.session.endAt.toISOString(),
    bookingStatus: booking.toPublic().status,
    attendance: booking.attendanceStatus || "pending",
    payment: booking.paymentStatus,
  }));
}

async function loadReport(req) {
  const { from, to } = dateRange(req.query);
  const filter = { startAt: { $gte: from, $lt: to } };
  if (req.query.instructor) filter.instructor = req.query.instructor;
  if (req.query.service) filter.title = req.query.service;
  const sessions = await ClassSession.find(filter).select("_id");
  const bookingFilter = { session: { $in: sessions.map((session) => session._id) } };
  if (req.query.status) bookingFilter.status = req.query.status;
  return Booking.find(bookingFilter)
    .populate("client", "name email")
    .populate("purchase", "referenceId")
    .populate({
      path: "session",
      populate: [
        { path: "instructor", select: "name" },
        { path: "room", select: "name" },
      ],
    })
    .sort("session.startAt");
}

router.get(
  "/overview",
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const tomorrow = new Date(todayStart);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const [todaySessionIds, upcomingSessionIds, endedSessionIds] = await Promise.all([
      ClassSession.find({ startAt: { $gte: todayStart, $lt: tomorrow } }).distinct("_id"),
      ClassSession.find({ startAt: { $gte: now } }).distinct("_id"),
      ClassSession.find({ endAt: { $lte: now } }).distinct("_id"),
    ]);
    const [totalBookings, todayBookings, upcomingBookings, completedBookings,
      cancelledBookings, instructors, clients, pendingApprovals, cancellationRequests, upcomingSessions] = await Promise.all([
      Booking.countDocuments(),
      Booking.countDocuments({ session: { $in: todaySessionIds } }),
      Booking.countDocuments({ status: { $in: ACTIVE_BOOKINGS }, session: { $in: upcomingSessionIds } }),
      Booking.countDocuments({ $or: [{ status: "attended" }, { attendanceStatus: "present",
        session: { $in: endedSessionIds } }] }),
      Booking.countDocuments({ status: "cancelled" }),
      User.countDocuments({ role: "instructor", active: true }),
      User.countDocuments({ role: "client" }),
      ClassSession.countDocuments({ status: "pending_approval" }),
      ClassSession.countDocuments({ status: "cancellation_requested" }),
      ClassSession.find({ startAt: { $gte: now }, status: { $ne: "cancelled" } })
        .populate("instructor", "name").populate("room", "name").sort("startAt").limit(6),
    ]);
    res.json({
      metrics: {
        totalBookings, todayBookings, upcomingBookings, completedBookings,
        cancelledBookings, availableInstructors: instructors, totalClients: clients,
        pendingApprovals, cancellationRequests,
      },
      upcomingSessions: upcomingSessions.map((session) => session.toPublic()),
      serverNow: now.toISOString(),
    });
  })
);

router.get(
  "/bookings",
  asyncHandler(async (req, res) => {
    const rows = reportRows(await loadReport(req));
    res.json({ rows, total: rows.length });
  })
);

router.get(
  "/bookings/export",
  asyncHandler(async (req, res) => {
    const rows = reportRows(await loadReport(req));
    const format = String(req.query.format || "csv").toLowerCase();
    const headers = ["Reference", "Client", "Email", "Service", "Instructor", "Room",
      "Start", "End", "Booking Status", "Attendance", "Payment"];
    const values = rows.map((row) => Object.values(row));
    if (!["csv", "excel"].includes(format)) {
      throw new HttpError(400, "Export format must be CSV or Excel.");
    }
    if (isSuperAdmin(req.user.role)) {
      await createAuditLog({
        actor: req.user, action: "DATA_EXPORTED",
        description: `Exported ${rows.length} booking report records as ${format.toUpperCase()}.`,
        entityType: "system", entityId: `booking-export:${Date.now()}`,
        entityLabel: "Booking report export",
        metadata: { format, rowCount: rows.length, filters: req.query },
      });
    }
    const separator = format === "excel" ? "\t" : ",";
    const encode = format === "excel"
      ? (value) => String(value ?? "").replaceAll("\t", " ")
      : csvCell;
    const output = [headers, ...values].map((row) => row.map(encode).join(separator)).join("\n");
    const extension = format === "excel" ? "xls" : "csv";
    res.setHeader("Content-Type", format === "excel"
      ? "application/vnd.ms-excel; charset=utf-8"
      : "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="anina-bookings.${extension}"`);
    res.send(`\uFEFF${output}`);
  })
);

export default router;
