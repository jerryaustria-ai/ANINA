import { Router } from "express";
import mongoose from "mongoose";
import { ClassSession, SESSION_TYPES } from "../models/ClassSession.js";
import { Room } from "../models/Room.js";
import { Booking } from "../models/Booking.js";
import { User } from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { findRoomConflict, findInstructorConflict, findClientConflict } from "../services/conflict.js";
import { asyncHandler, HttpError } from "../utils/http.js";
import { assertScheduleBookable, assertScheduleDateNotPast } from "../services/scheduleTime.js";
import { createNotification, notifyAdmins } from "../services/notifications.js";
import { Notification } from "../models/Notification.js";
import { SessionAudit } from "../models/SessionAudit.js";
import { createAuditLog } from "../services/audit.js";
import { GuestPurchase } from "../models/GuestPurchase.js";
import { sendPurchaseStatusEmailOnce } from "../services/email.js";
import { randomUUID } from "node:crypto";
import { ClassDefinition } from "../models/ClassDefinition.js";
import {
  findEligibleMembership,
  reserveMembershipCredit,
  returnMembershipCredit,
} from "../services/membership.js";

const router = Router();

const populate = (q) =>
  q.populate("instructor", "name email picture role active")
    .populate("room", "name color maxCapacity location active")
    .populate("classDefinition", "title description type defaultCapacity defaultMinToRun active");

const ACTIVE_CLIENT_STATUSES = ["pending", "accepted", "approved", "confirmed", "booked", "waitlisted", "active"];

async function emailGuestBookingCancellations(bookings, cancelledAt, eventPrefix) {
  await Promise.all(bookings.filter((booking) => booking.purchase).map(async (booking) => {
    const purchase = await GuestPurchase.findById(booking.purchase);
    if (!purchase) return;
    purchase.status = "cancelled";
    purchase.cancelledAt = cancelledAt;
    await purchase.save();
    await sendPurchaseStatusEmailOnce(
      purchase._id,
      "booking_cancelled",
      `${eventPrefix}:${booking._id}`,
      { cancelledAt }
    ).catch((error) => console.warn("Booking cancellation email failed:", error.message));
  }));
}

function activeClientQuery(sessionId) {
  return {
    session: sessionId,
    status: { $in: ACTIVE_CLIENT_STATUSES },
    isDeleted: { $ne: true },
  };
}

async function recordScheduleAudit(session, action, actor, dbSession = null, previousValue = null) {
  await SessionAudit.create([{
    sessionId: session._id,
    action,
    performedBy: actor._id,
    performedByRole: actor.role,
    sessionSnapshot: session.toObject({ depopulate: true }),
    bookingSnapshots: [],
  }], dbSession ? { session: dbSession } : undefined);
  const descriptions = {
    SUBMITTED: `Submitted ${session.title} for Admin approval.`,
    RESUBMITTED: `Resubmitted ${session.title} for Admin approval.`,
    APPROVED: `Approved and published ${session.title}.`,
    REJECTED: `Rejected ${session.title}.`,
    CHANGES_REQUESTED: `Requested changes to ${session.title}.`,
    PERMANENTLY_DELETED: `Permanently deleted ${session.title}.`,
  };
  await createAuditLog({
    actor,
    action: `SCHEDULE_${action}`,
    description: descriptions[action] || `${action} ${session.title}.`,
    entityType: "schedule",
    entityId: session._id,
    entityLabel: session.title,
    previousValue,
    updatedValue: action === "PERMANENTLY_DELETED" ? null : session,
    dbSession,
  });
}

function ownsOrAdmin(req, session) {
  return req.user.role === "admin" || session.instructor._id?.toString() === req.user._id.toString() ||
    session.instructor.toString?.() === req.user._id.toString();
}

async function announceSchedule(session, actorId, action, { previousInstructorId = null, clientsOverride = null } = {}) {
  const [instructor, activeBookings] = await Promise.all([
    User.findById(session.instructor),
    Booking.find({ session: session._id, status: { $in: ["pending", "accepted", "waitlisted"] } }).populate("client"),
  ]);
  const clients = clientsOverride || activeBookings.map((booking) => booking.client).filter(Boolean);
  const eventKey = `schedule:${session._id}:${action}:${session.updatedAt?.getTime() || Date.now()}`;
  const when = new Intl.DateTimeFormat("en-PH", {
    timeZone: process.env.APP_TIMEZONE || "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(session.startAt);
  const titles = {
    created: ["SCHEDULE_CREATED", "Schedule Created"],
    updated: ["SCHEDULE_UPDATED", "Schedule Updated"],
    rescheduled: ["SCHEDULE_RESCHEDULED", "Schedule Rescheduled"],
    cancelled: ["SCHEDULE_CANCELLED", "Schedule Cancelled"],
    status: ["BOOKING_STATUS_CHANGED", "Class Status Changed"],
    instructor_changed: ["INSTRUCTOR_CHANGED", "Instructor Changed"],
  };
  const [type, title] = titles[action] || titles.updated;
  const message = action === "rescheduled"
    ? `${session.title} was moved to ${when}.`
    : action === "cancelled"
      ? `${session.title} scheduled for ${when} was cancelled.`
      : action === "instructor_changed"
        ? `${session.title} is now assigned to ${instructor?.name || "a new instructor"}.`
        : `${session.title} was ${action} for ${when}.`;

  if (instructor && instructor._id.toString() !== String(actorId)) {
    await createNotification({
      recipient: instructor, type, title, message,
      relatedScheduleId: session._id, relatedUserId: instructor._id, eventKey,
    });
  }
  if (previousInstructorId && String(previousInstructorId) !== String(session.instructor)) {
    const previous = await User.findById(previousInstructorId);
    if (previous && previous._id.toString() !== String(actorId)) {
      await createNotification({
        recipient: previous, type: "INSTRUCTOR_CHANGED", title: "Instructor Assignment Changed",
        message: `You are no longer assigned to ${session.title}.`,
        relatedScheduleId: session._id, relatedUserId: previous._id, eventKey,
      });
    }
  }
  await Promise.all(clients.map((client) => createNotification({
    recipient: client, type, title, message,
    relatedScheduleId: session._id, relatedUserId: instructor?._id, eventKey,
  })));
  await notifyAdmins({
    type, title, message, relatedScheduleId: session._id, relatedUserId: instructor?._id, eventKey,
  }, actorId);
}

// Validate + normalise a session's time/room/capacity. Shared by create & update.
async function validateSlot({ roomId, startAt, endAt, capacity, excludeId, instructorId, enforceNotPast = false }) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (isNaN(start) || isNaN(end)) throw new HttpError(400, "Invalid start/end time");
  if (end <= start) throw new HttpError(400, "End time must be after start time");
  if (enforceNotPast) assertScheduleDateNotPast(start);

  const instructor = await User.findOne({ _id: instructorId, role: "instructor", active: true });
  if (!instructor) throw new HttpError(400, "Assigned instructor was not found or is inactive");

  const room = await Room.findById(roomId);
  if (!room || !room.active) throw new HttpError(400, "Room not found or inactive");
  if (capacity > room.maxCapacity) {
    throw new HttpError(400, `Capacity ${capacity} exceeds room max of ${room.maxCapacity}`);
  }

  const roomClash = await findRoomConflict({ roomId, startAt: start, endAt: end, excludeId });
  if (roomClash) {
    throw new HttpError(409, `Room "${room.name}" is already booked for that time ("${roomClash.title}")`);
  }
  const instClash = await findInstructorConflict({ instructorId, startAt: start, endAt: end, excludeId });
  if (instClash) {
    throw new HttpError(409, `${instructor.name} already has a schedule that overlaps this time`);
  }
  return { room, start, end };
}

// Public, read-only weekly schedule. Only explicitly published schedules are
// exposed, with a deliberately small set of non-sensitive fields.
router.get(
  "/public",
  asyncHandler(async (req, res) => {
    const from = new Date(req.query.from);
    const to = new Date(req.query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      throw new HttpError(400, "A valid public schedule date range is required.");
    }
    if (to.getTime() - from.getTime() > 8 * 24 * 60 * 60 * 1000) {
      throw new HttpError(400, "Public schedule requests are limited to one week.");
    }
    const publishedFilter = {
      status: "published",
      isPublished: true,
      approvedAt: { $ne: null },
    };
    const [sessions, nearest] = await Promise.all([
      ClassSession.find({
        ...publishedFilter,
        startAt: { $gte: from, $lt: to },
      })
        .populate("instructor", "name active")
        .populate("room", "name location active")
        .sort("startAt"),
      req.query.includeNearest === "1"
        ? ClassSession.findOne({ ...publishedFilter, startAt: { $gte: new Date() } }).sort("startAt").select("startAt")
        : null,
    ]);
    const available = sessions.filter((session) =>
      session.instructor?.active !== false && session.room?.active !== false);
    res.json({
      nearestStartAt: nearest?.startAt || null,
      sessions: available.map((session) => ({
        id: session._id,
        title: session.title,
        type: session.type,
        instructor: { id: session.instructor?._id, name: session.instructor?.name || "ANINA Instructor" },
        room: session.room ? { id: session.room._id, name: session.room.name, location: session.room.location } : null,
        startAt: session.startAt,
        endAt: session.endAt,
        capacity: session.capacity,
        acceptedCount: session.acceptedCount,
        availableSlots: Math.max(0, session.capacity - session.acceptedCount),
        status: "published",
        isPublished: true,
      })),
    });
  })
);

router.use(requireAuth);

// GET /api/sessions?from=&to=&room=&instructor=&mine=1&status=&type=
// Role-aware: clients never see other people's drafts.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { from, to, room, instructor, mine, status, type } = req.query;
    const filter = {};
    if (from || to) {
      filter.startAt = {};
      if (from) filter.startAt.$gte = new Date(from);
      if (to) filter.startAt.$lte = new Date(to);
    }
    if (room) filter.room = room;
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (instructor) filter.instructor = instructor;
    if (mine === "1") filter.instructor = req.user._id;

    // Clients only ever see published classes (open/confirmed), never drafts.
    if (req.user.role === "client") {
      filter.status = "published";
      filter.isPublished = true;
      filter.startAt = { ...(filter.startAt || {}), $gt: new Date() };
    }

    const sessions = await populate(ClassSession.find(filter).sort("startAt"));
    const visible = req.user.role === "client"
      ? sessions.filter((session) => session.instructor?.active !== false && session.room?.active !== false)
      : sessions;
    res.json({ sessions: visible.map((s) => s.toPublic()) });
  })
);

// POST /api/sessions — instructors create their own; admin may create for anyone.
router.post(
  "/",
  requireRole("instructor", "admin"),
  asyncHandler(async (req, res) => {
    const { title, type = "group", room, startAt, endAt, capacity, minToRun = 1, notes, color, classDefinition } = req.body || {};
    const instructorId = req.body.instructor && req.user.role === "admin" ? req.body.instructor : req.user._id;

    if (!title || !room || !startAt || !endAt || !capacity) {
      throw new HttpError(400, "title, room, startAt, endAt and capacity are required");
    }
    if (!SESSION_TYPES.includes(type)) throw new HttpError(400, "Invalid session type");
    if (classDefinition) {
      const official = await ClassDefinition.findOne({ _id: classDefinition, active: true });
      if (!official) throw new HttpError(400, "The selected official class title is unavailable.");
      if (official.title !== title) throw new HttpError(400, "Class title does not match the selected official class.");
    }
    const cap = type === "private" ? 1 : Number(capacity);
    const min = type === "private" ? 1 : Number(minToRun);
    if (min > cap) throw new HttpError(400, "minToRun cannot exceed capacity");

    await validateSlot({ roomId: room, startAt, endAt, capacity: cap, instructorId, enforceNotPast: true });

    const instructorSubmission = req.user.role === "instructor";
    const now = new Date();
    const session = await ClassSession.create({
      title, classDefinition: classDefinition || null, type, instructor: instructorId, room,
      startAt, endAt, capacity: cap, minToRun: min,
      notes, color,
      status: instructorSubmission ? "pending_approval" : "published",
      isPublished: !instructorSubmission,
      submittedAt: instructorSubmission ? now : null,
      approvedBy: instructorSubmission ? null : req.user._id,
      approvedAt: instructorSubmission ? null : now,
    });
    await createAuditLog({
      actor: req.user, action: "SCHEDULE_CREATED",
      description: `Created ${session.title}${instructorSubmission ? " and submitted it for Admin approval" : ""}.`,
      entityType: "schedule", entityId: session._id, entityLabel: session.title,
      updatedValue: session,
    });
    await recordScheduleAudit(session, instructorSubmission ? "SUBMITTED" : "APPROVED", req.user);
    if (instructorSubmission) {
      await notifyAdmins({
        type: "SCHEDULE_SUBMITTED_FOR_APPROVAL",
        title: "Schedule Awaiting Approval",
        message: `${req.user.name} submitted ${session.title} for approval.`,
        relatedUserId: req.user._id,
        relatedScheduleId: session._id,
        eventKey: `schedule-submitted:${session._id}:${session.submittedAt.getTime()}`,
      });
    } else {
      await announceSchedule(session, req.user._id, "created");
    }
    res.status(201).json({ session: (await populate(ClassSession.findById(session._id))).toPublic() });
  })
);

// Admin approval queue.
router.get(
  "/approvals/pending",
  requireRole("admin"),
  asyncHandler(async (_req, res) => {
    const sessions = await populate(ClassSession.find({
      status: "pending_approval",
      isPublished: false,
    }).sort("submittedAt"));
    res.json({ sessions: sessions.map((session) => session.toPublic()) });
  })
);

async function reviewSchedule(req, status, details = {}) {
  const session = await ClassSession.findById(req.params.id);
  if (!session) throw new HttpError(404, "Session not found");
  if (session.status !== "pending_approval") {
    throw new HttpError(409, "This schedule is not awaiting Admin review.");
  }
  if (status === "published") {
    try {
      await validateSlot({
        roomId: session.room,
        startAt: session.startAt,
        endAt: session.endAt,
        capacity: session.capacity,
        excludeId: session._id,
        instructorId: session.instructor,
      });
    } catch (error) {
      if (error.status === 409) {
        const instructor = await User.findById(session.instructor);
        const eventKey = `schedule-conflict:${session._id}:${Date.now()}`;
        await createNotification({
          recipient: instructor,
          type: "SCHEDULE_CONFLICT",
          title: "Schedule Conflict",
          message: `${session.title} cannot be approved yet: ${error.message}`,
          relatedScheduleId: session._id,
          eventKey,
        });
        await notifyAdmins({
          type: "SCHEDULE_CONFLICT",
          title: "Schedule Conflict",
          message: `${session.title}: ${error.message}`,
          relatedScheduleId: session._id,
          eventKey,
        }, req.user._id);
      }
      throw error;
    }
  }
  const previous = session.toObject({ depopulate: true });
  const instructor = await User.findById(session.instructor);
  const now = new Date();
  session.status = status;
  session.isPublished = status === "published";
  session.reviewedBy = req.user._id;
  session.reviewedAt = now;
  session.approvedBy = status === "published" ? req.user._id : null;
  session.approvedAt = status === "published" ? now : null;
  session.rejectionReason = details.reason || "";
  session.changeRequestNotes = details.notes || "";
  await session.save();

  const config = {
    published: ["APPROVED", "SCHEDULE_APPROVED", "Schedule Approved", `${session.title} was approved and published.`],
    rejected: ["REJECTED", "SCHEDULE_REJECTED", "Schedule Rejected", `${session.title} was rejected: ${details.reason}`],
    changes_requested: ["CHANGES_REQUESTED", "SCHEDULE_CHANGES_REQUESTED", "Changes Requested", `Changes were requested for ${session.title}: ${details.notes}`],
  }[status];
  await recordScheduleAudit(session, config[0], req.user, null, previous);
  await createNotification({
    recipient: instructor,
    type: config[1],
    title: config[2],
    message: config[3],
    relatedUserId: instructor?._id,
    relatedScheduleId: session._id,
    eventKey: `schedule-review:${session._id}:${status}:${now.getTime()}`,
  });
  return populate(ClassSession.findById(session._id));
}

router.post(
  "/:id/approve",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const session = await reviewSchedule(req, "published");
    res.json({ session: session.toPublic() });
  })
);

router.post(
  "/:id/reject",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const reason = String(req.body?.reason || "").trim();
    if (!reason) throw new HttpError(400, "A rejection reason is required.");
    const session = await reviewSchedule(req, "rejected", { reason });
    res.json({ session: session.toPublic() });
  })
);

router.post(
  "/:id/request-changes",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const notes = String(req.body?.notes || "").trim();
    if (!notes) throw new HttpError(400, "Change request notes are required.");
    const session = await reviewSchedule(req, "changes_requested", { notes });
    res.json({ session: session.toPublic() });
  })
);

router.post(
  "/:id/hold",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const session = await ClassSession.findById(req.params.id);
    if (!session) throw new HttpError(404, "Session not found");
    if (!["pending_approval", "on_hold"].includes(session.status)) {
      throw new HttpError(409, "Only a pending or held schedule can be placed on hold.");
    }
    const previous = session.toObject({ depopulate: true });
    session.status = "on_hold";
    session.isPublished = false;
    session.reviewedBy = req.user._id;
    session.reviewedAt = new Date();
    session.changeRequestNotes = String(req.body?.reason || "").trim();
    await session.save();
    const instructor = await User.findById(session.instructor);
    await createNotification({
      recipient: instructor,
      type: "SCHEDULE_ON_HOLD",
      title: "Schedule On Hold",
      message: `${session.title} was placed on hold${session.changeRequestNotes ? `: ${session.changeRequestNotes}` : "."}`,
      relatedScheduleId: session._id,
      eventKey: `schedule-hold:${session._id}:${session.reviewedAt.getTime()}`,
    });
    await createAuditLog({
      actor: req.user, action: "SCHEDULE_ON_HOLD",
      description: `Placed ${session.title} on hold.`,
      entityType: "schedule", entityId: session._id, entityLabel: session.title,
      previousValue: previous, updatedValue: session,
    });
    res.json({ session: (await populate(ClassSession.findById(session._id))).toPublic() });
  })
);

router.post(
  "/:id/review-held",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const session = await ClassSession.findById(req.params.id);
    if (!session) throw new HttpError(404, "Session not found");
    if (session.status !== "on_hold") throw new HttpError(409, "This schedule is not on hold.");
    session.status = "pending_approval";
    session.changeRequestNotes = "";
    await session.save();
    res.json({ session: (await populate(ClassSession.findById(session._id))).toPublic() });
  })
);

router.post(
  "/:id/resubmit",
  requireRole("instructor"),
  asyncHandler(async (req, res) => {
    const session = await ClassSession.findById(req.params.id);
    if (!session) throw new HttpError(404, "Session not found");
    if (session.instructor.toString() !== req.user._id.toString()) throw new HttpError(403, "Not your session");
    if (!["rejected", "changes_requested"].includes(session.status)) {
      throw new HttpError(409, "Only rejected schedules or schedules with requested changes can be resubmitted.");
    }
    const previous = session.toObject({ depopulate: true });
    session.status = "pending_approval";
    session.isPublished = false;
    session.submittedAt = new Date();
    session.rejectionReason = "";
    session.changeRequestNotes = "";
    await session.save();
    await recordScheduleAudit(session, "RESUBMITTED", req.user, null, previous);
    await notifyAdmins({
      type: "SCHEDULE_RESUBMITTED",
      title: "Schedule Resubmitted",
      message: `${req.user.name} resubmitted ${session.title} for approval.`,
      relatedUserId: req.user._id,
      relatedScheduleId: session._id,
      eventKey: `schedule-resubmitted:${session._id}:${session.submittedAt.getTime()}`,
    });
    res.json({ session: (await populate(ClassSession.findById(session._id))).toPublic() });
  })
);

// POST /api/sessions/recurring — create a weekly series. Instructor-created
// occurrences remain unpublished until each occurrence is reviewed by Admin.
router.post(
  "/recurring",
  requireRole("instructor", "admin"),
  asyncHandler(async (req, res) => {
    const {
      title, type = "group", room, startAt, endAt, capacity, minToRun = 1,
      notes = "", color = "", weekdays = [], until, instructor: requestedInstructor,
      frequency = "weekly", classDefinition,
    } = req.body || {};
    const instructorId = req.user.role === "admin" && requestedInstructor
      ? requestedInstructor : req.user._id;
    if (!title || !room || !startAt || !endAt || !capacity || !until) {
      throw new HttpError(400, "Recurring schedules require title, room, start, end, capacity, and end date.");
    }
    if (!["daily", "weekly", "monthly"].includes(frequency)) {
      throw new HttpError(400, "Recurrence must be daily, weekly, or monthly.");
    }
    const selectedDays = [...new Set((Array.isArray(weekdays) ? weekdays : []).map(Number))];
    if (frequency === "weekly" &&
        (!selectedDays.length || selectedDays.some((day) => day < 0 || day > 6))) {
      throw new HttpError(400, "Select at least one valid weekday.");
    }
    if (!SESSION_TYPES.includes(type)) throw new HttpError(400, "Invalid session type");
    if (classDefinition) {
      const official = await ClassDefinition.findOne({ _id: classDefinition, active: true });
      if (!official || official.title !== title) {
        throw new HttpError(400, "The selected official class title is unavailable.");
      }
    }
    const firstStart = new Date(startAt);
    const firstEnd = new Date(endAt);
    const lastDate = new Date(until);
    lastDate.setHours(23, 59, 59, 999);
    if (Number.isNaN(lastDate.getTime()) || lastDate < firstStart) {
      throw new HttpError(400, "The recurring end date must be on or after the first schedule date.");
    }
    if (lastDate.getTime() - firstStart.getTime() > 366 * 24 * 60 * 60 * 1000) {
      throw new HttpError(400, "A recurring schedule series cannot exceed one year.");
    }
    const duration = firstEnd.getTime() - firstStart.getTime();
    if (duration <= 0) throw new HttpError(400, "End time must be after start time");
    const cap = type === "private" ? 1 : Number(capacity);
    const min = type === "private" ? 1 : Number(minToRun);
    if (min > cap) throw new HttpError(400, "minToRun cannot exceed capacity");

    const occurrences = [];
    const cursor = new Date(firstStart);
    cursor.setHours(firstStart.getHours(), firstStart.getMinutes(), 0, 0);
    while (cursor <= lastDate) {
      const matches = frequency === "daily" ||
        (frequency === "weekly" && selectedDays.includes(cursor.getDay())) ||
        (frequency === "monthly" && cursor.getDate() === firstStart.getDate());
      if (cursor >= firstStart && matches) {
        occurrences.push({ start: new Date(cursor), end: new Date(cursor.getTime() + duration) });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    if (!occurrences.length) throw new HttpError(400, "The selected recurrence does not create any schedules.");
    if (occurrences.length > 160) throw new HttpError(400, "This recurring series creates too many schedules.");

    for (const occurrence of occurrences) {
      await validateSlot({
        roomId: room, startAt: occurrence.start, endAt: occurrence.end,
        capacity: cap, instructorId, enforceNotPast: true,
      });
    }
    const instructorSubmission = req.user.role === "instructor";
    const now = new Date();
    const recurrenceGroupId = randomUUID();
    const created = await ClassSession.insertMany(occurrences.map((occurrence) => ({
      title, classDefinition: classDefinition || null, type, instructor: instructorId, room,
      startAt: occurrence.start, endAt: occurrence.end,
      capacity: cap, minToRun: min, notes, color, recurrenceGroupId,
      status: instructorSubmission ? "pending_approval" : "published",
      isPublished: !instructorSubmission,
      submittedAt: instructorSubmission ? now : null,
      approvedBy: instructorSubmission ? null : req.user._id,
      approvedAt: instructorSubmission ? null : now,
    })));
    await Promise.all(created.map((session) => createAuditLog({
      actor: req.user, action: "RECURRING_SCHEDULE_CREATED",
      description: `Created recurring occurrence ${session.title} on ${session.startAt.toISOString()}.`,
      entityType: "schedule", entityId: session._id, entityLabel: session.title,
      updatedValue: session,
    })));
    if (instructorSubmission) {
      await notifyAdmins({
        type: "SCHEDULE_SUBMITTED_FOR_APPROVAL",
        title: "Recurring Schedule Awaiting Approval",
        message: `${req.user.name} submitted ${created.length} ${title} schedules for approval.`,
        relatedUserId: req.user._id,
        relatedScheduleId: created[0]._id,
        eventKey: `recurring-submitted:${recurrenceGroupId}`,
      });
    }
    res.status(201).json({
      recurrenceGroupId,
      count: created.length,
      sessions: (await populate(ClassSession.find({ recurrenceGroupId }).sort("startAt")))
        .map((session) => session.toPublic()),
    });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const session = await populate(ClassSession.findById(req.params.id));
    if (!session) throw new HttpError(404, "Session not found");
    if (req.user.role === "client" && (session.status !== "published" || session.isPublished !== true)) {
      throw new HttpError(403, "This schedule is not yet available.");
    }
    if (req.user.role === "instructor" &&
        session.instructor?._id?.toString() !== req.user._id.toString() &&
        session.isPublished !== true) {
      throw new HttpError(403, "You cannot access another Instructor's unpublished schedule.");
    }
    res.json({ session: session.toPublic() });
  })
);

// Instructors may add operational notes without changing the approved schedule.
router.patch(
  "/:id/session-notes",
  requireRole("instructor", "admin"),
  asyncHandler(async (req, res) => {
    const session = await ClassSession.findById(req.params.id);
    if (!session) throw new HttpError(404, "Session not found");
    if (!ownsOrAdmin(req, session)) throw new HttpError(403, "Not your session");
    const previous = {
      sessionNotes: session.sessionNotes,
      progressNotes: session.progressNotes,
    };
    if (req.body?.sessionNotes !== undefined) {
      session.sessionNotes = String(req.body.sessionNotes).trim().slice(0, 5000);
    }
    if (req.body?.progressNotes !== undefined) {
      session.progressNotes = String(req.body.progressNotes).trim().slice(0, 5000);
    }
    await session.save();
    await createAuditLog({
      actor: req.user, action: "SESSION_NOTES_UPDATED",
      description: `Updated session notes for ${session.title}.`,
      entityType: "schedule", entityId: session._id, entityLabel: session.title,
      previousValue: previous,
      updatedValue: {
        sessionNotes: session.sessionNotes,
        progressNotes: session.progressNotes,
      },
    });
    res.json({ session: (await populate(ClassSession.findById(session._id))).toPublic() });
  })
);

// PATCH /api/sessions/:id — owner instructor or admin. Re-checks conflicts.
router.patch(
  "/:id",
  requireRole("instructor", "admin"),
  asyncHandler(async (req, res) => {
    const session = await ClassSession.findById(req.params.id);
    if (!session) throw new HttpError(404, "Session not found");
    if (!ownsOrAdmin(req, session)) throw new HttpError(403, "Not your session");
    const previous = session.toObject({ depopulate: true });

    const b = req.body || {};
    const previousInstructorId = session.instructor;
    const previousStatus = session.status;
    const timeChanged = (b.startAt !== undefined && new Date(b.startAt).getTime() !== session.startAt.getTime()) ||
      (b.endAt !== undefined && new Date(b.endAt).getTime() !== session.endAt.getTime());
    const instructorId = req.user.role === "admin" && b.instructor ? b.instructor : session.instructor;
    if (b.classDefinition !== undefined && b.classDefinition) {
      const official = await ClassDefinition.findOne({ _id: b.classDefinition, active: true });
      if (!official || (b.title !== undefined && official.title !== b.title)) {
        throw new HttpError(400, "The selected official class title is unavailable.");
      }
    }
    const next = {
      roomId: b.room ?? session.room,
      startAt: b.startAt ?? session.startAt,
      endAt: b.endAt ?? session.endAt,
      capacity: b.capacity ?? session.capacity,
    };
    if (next.capacity < session.acceptedCount) {
      throw new HttpError(400, `Capacity can't drop below ${session.acceptedCount} already-accepted bookings`);
    }
    await validateSlot({ ...next, excludeId: session._id, instructorId, enforceNotPast: timeChanged });

    if (req.user.role === "admin" && Array.isArray(b.clientIds)) {
      const submittedIds = b.clientIds.map(String);
      const uniqueIds = [...new Set(submittedIds)];
      if (uniqueIds.length !== submittedIds.length) throw new HttpError(400, "A client cannot be assigned more than once");
      if (uniqueIds.some((id) => !mongoose.isValidObjectId(id))) throw new HttpError(400, "One or more client IDs are invalid");
      if (uniqueIds.length > Number(next.capacity)) {
        throw new HttpError(400, `Selected ${uniqueIds.length} clients, but this class has a maximum capacity of ${next.capacity}`);
      }
      const selectedClients = await User.find({ _id: { $in: uniqueIds }, role: "client", active: true });
      if (selectedClients.length !== uniqueIds.length) throw new HttpError(400, "One or more selected clients were not found or are inactive");
      for (const client of selectedClients) {
        const clash = await findClientConflict({
          clientId: client._id,
          startAt: new Date(next.startAt),
          endAt: new Date(next.endAt),
          excludeSessionId: session._id,
        });
        if (clash) throw new HttpError(409, `${client.name} already has another booking during the new schedule time`);
      }
    }

    const activeBookings = await Booking.find({
      session: session._id,
      status: { $in: ["pending", "accepted", "waitlisted"] },
    });
    for (const booking of activeBookings) {
      const clash = await findClientConflict({
        clientId: booking.client,
        startAt: new Date(next.startAt),
        endAt: new Date(next.endAt),
        excludeSessionId: session._id,
        excludeBookingId: booking._id,
      });
      if (clash) throw new HttpError(409, "A booked client already has another booking during the new time");
    }

    ["title", "notes", "color", "startAt", "endAt", "capacity", "minToRun"].forEach((k) => {
      if (b[k] !== undefined) session[k] = b[k];
    });
    if (b.room !== undefined) session.room = b.room;
    if (b.classDefinition !== undefined) session.classDefinition = b.classDefinition || null;
    if (req.user.role === "admin" && b.instructor !== undefined) session.instructor = instructorId;
    if (req.user.role === "instructor") {
      session.status = "pending_approval";
      session.isPublished = false;
      session.submittedAt = new Date();
      session.approvedBy = null;
      session.approvedAt = null;
      session.reviewedBy = null;
      session.reviewedAt = null;
      session.rejectionReason = "";
      session.changeRequestNotes = "";
    } else if (b.status === "completed") {
      session.status = "completed";
      session.isPublished = false;
    } else if (["pending_approval", "on_hold", "rejected", "changes_requested"].includes(b.status)) {
      session.status = b.status;
      session.isPublished = false;
    } else if (!["cancelled", "completed"].includes(session.status)) {
      session.status = "published";
      session.isPublished = true;
    }
    await session.save();
    if (req.user.role === "instructor") {
      const auditAction = ["rejected", "changes_requested"].includes(previousStatus) ? "RESUBMITTED" : "SUBMITTED";
      await recordScheduleAudit(session, auditAction, req.user, null, previous);
      await notifyAdmins({
        type: auditAction === "RESUBMITTED" ? "SCHEDULE_RESUBMITTED" : "SCHEDULE_SUBMITTED_FOR_APPROVAL",
        title: auditAction === "RESUBMITTED" ? "Schedule Resubmitted" : "Schedule Revision Awaiting Approval",
        message: `${req.user.name} submitted changes to ${session.title} for approval.`,
        relatedUserId: req.user._id,
        relatedScheduleId: session._id,
        eventKey: `schedule-edit-submitted:${session._id}:${session.submittedAt.getTime()}`,
      });
    } else {
      await createAuditLog({
        actor: req.user,
        action: timeChanged ? "SCHEDULE_RESCHEDULED" : "SCHEDULE_UPDATED",
        description: `${timeChanged ? "Rescheduled" : "Updated"} ${session.title}.`,
        entityType: "schedule", entityId: session._id, entityLabel: session.title,
        previousValue: previous, updatedValue: session,
      });
      await announceSchedule(session, req.user._id,
        timeChanged ? "rescheduled"
          : b.instructor && String(previousInstructorId) !== String(session.instructor) ? "instructor_changed"
            : "updated",
        { previousInstructorId });
    }
    res.json({ session: (await populate(ClassSession.findById(session._id))).toPublic() });
  })
);

// POST /api/sessions/:id/confirm — lock the class as running (needs min headcount).
router.post(
  "/:id/confirm",
  requireRole("instructor", "admin"),
  asyncHandler(async (req, res) => {
    const session = await ClassSession.findById(req.params.id);
    if (!session) throw new HttpError(404, "Session not found");
    if (!ownsOrAdmin(req, session)) throw new HttpError(403, "Not your session");
    const previous = session.toObject({ depopulate: true });
    if (session.acceptedCount < session.minToRun) {
      throw new HttpError(400, `Need ${session.minToRun} accepted, have ${session.acceptedCount}`);
    }
    session.status = "published";
    session.isPublished = true;
    await session.save();
    await createAuditLog({
      actor: req.user, action: "SCHEDULE_CONFIRMED",
      description: `Confirmed ${session.title} as running.`,
      entityType: "schedule", entityId: session._id, entityLabel: session.title,
      previousValue: previous, updatedValue: session,
    });
    await announceSchedule(session, req.user._id, "status");
    res.json({ session: (await populate(ClassSession.findById(session._id))).toPublic() });
  })
);

// Admin-only, database-current deletion eligibility.
router.get(
  "/:id/deletion-eligibility",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const classSession = await ClassSession.findById(req.params.id);
    if (!classSession) throw new HttpError(404, "Session not found");
    const activeClientRecords = await Booking.countDocuments(activeClientQuery(classSession._id));
    const wasCancelledByAssignedInstructor =
      classSession.status === "cancelled" &&
      classSession.cancelledByRole === "instructor" &&
      classSession.cancelledBy?.toString() === classSession.instructor.toString();
    res.json({
      eligible: wasCancelledByAssignedInstructor && activeClientRecords === 0,
      activeClientRecords,
      wasCancelledByAssignedInstructor,
      reason: !wasCancelledByAssignedInstructor
        ? "The assigned Instructor must cancel this session before it can be deleted."
        : activeClientRecords > 0
          ? "This session cannot be deleted because it still has an active booking or pending spot request."
          : null,
      cancellation: classSession.status === "cancelled" ? {
        cancelledBy: classSession.cancelledBy,
        cancelledByRole: classSession.cancelledByRole,
        cancelledAt: classSession.cancelledAt,
        cancellationReason: classSession.cancellationReason,
      } : null,
    });
  })
);

// DELETE /api/sessions/:id — admin-only hard delete when no active client
// booking/request/assignment/waitlist remains. Inactive history is snapshotted.
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const transaction = await mongoose.startSession();
    let deleted = null;
    try {
      await transaction.withTransaction(async () => {
        const classSession = await ClassSession.findById(req.params.id).session(transaction);
        if (!classSession) throw new HttpError(404, "Session not found");

        const wasCancelledByAssignedInstructor =
          classSession.status === "cancelled" &&
          classSession.cancelledByRole === "instructor" &&
          classSession.cancelledBy?.toString() === classSession.instructor.toString();
        if (!wasCancelledByAssignedInstructor) {
          throw new HttpError(409, "This session cannot be deleted until the assigned Instructor cancels it.");
        }

        const activeClientRecords = await Booking.countDocuments(activeClientQuery(classSession._id)).session(transaction);
        if (activeClientRecords > 0) {
          throw new HttpError(
            409,
            "This session cannot be deleted because it still has an active booking or pending spot request."
          );
        }

        const bookingSnapshots = await Booking.find({ session: classSession._id }).lean().session(transaction);
        await SessionAudit.create([{
          sessionId: classSession._id,
          action: "PERMANENTLY_DELETED",
          performedBy: req.user._id,
          performedByRole: req.user.role,
          sessionSnapshot: classSession.toObject({ depopulate: true }),
          bookingSnapshots,
        }], { session: transaction });
        await createAuditLog({
          actor: req.user, action: "SCHEDULE_PERMANENTLY_DELETED",
          description: `Permanently deleted ${classSession.title}.`,
          entityType: "schedule", entityId: classSession._id, entityLabel: classSession.title,
          previousValue: classSession, metadata: { bookingSnapshots },
          dbSession: transaction,
        });

        // Inactive linked bookings are preserved in the audit snapshot, then
        // removed to avoid orphan references. Users/instructors/rooms remain.
        await Booking.deleteMany({ session: classSession._id }).session(transaction);
        await Notification.deleteMany({ relatedScheduleId: classSession._id }).session(transaction);
        await ClassSession.deleteOne({ _id: classSession._id }).session(transaction);
        deleted = true;
      });
    } finally {
      await transaction.endSession();
    }
    if (!deleted) throw new HttpError(409, "Session could not be deleted");
    res.json({
      ok: true,
      message: "Session deleted successfully.",
    });
  })
);

// POST /api/sessions/:id/cancel — Instructors submit a request; Admin performs
// the final cancellation after reviewing affected clients.
router.post(
  "/:id/cancel",
  requireRole("instructor", "admin"),
  asyncHandler(async (req, res) => {
    const session = await ClassSession.findById(req.params.id);
    if (!session) throw new HttpError(404, "Session not found");
    if (!ownsOrAdmin(req, session)) throw new HttpError(403, "Not your session");
    if (session.status === "cancelled") {
      throw new HttpError(409, "This session has already been cancelled.");
    }
    const previous = session.toObject({ depopulate: true });
    const affectedBookings = await Booking.find({
      session: session._id,
      status: { $in: ["pending", "accepted", "waitlisted"] },
    }).populate("client");
    if (req.user.role === "instructor") {
      session.status = "cancellation_requested";
      session.isPublished = false;
      session.cancellationRequestedBy = req.user._id;
      session.cancellationRequestedAt = new Date();
      session.cancellationRequestReason = String(req.body?.reason || "").trim();
      await session.save();
      await notifyAdmins({
        type: "SCHEDULE_CANCELLATION_REQUESTED",
        title: "Class Cancellation Requested",
        message: `${req.user.name} requested cancellation of ${session.title}. ${affectedBookings.length} active booking${affectedBookings.length === 1 ? "" : "s"} require review.`,
        relatedUserId: req.user._id,
        relatedScheduleId: session._id,
        eventKey: `schedule-cancellation-request:${session._id}:${session.cancellationRequestedAt.getTime()}`,
      });
      await createAuditLog({
        actor: req.user, action: "SCHEDULE_CANCELLATION_REQUESTED",
        description: `Requested cancellation of ${session.title}.`,
        entityType: "schedule", entityId: session._id, entityLabel: session.title,
        previousValue: previous, updatedValue: session,
        metadata: { affectedBookingCount: affectedBookings.length },
      });
      return res.json({
        requested: true,
        affectedBookingCount: affectedBookings.length,
        message: affectedBookings.length
          ? "Cancellation request sent to Admin. Affected clients must be notified before cancellation."
          : "Cancellation request sent to Admin.",
        session: (await populate(ClassSession.findById(session._id))).toPublic(),
      });
    }
    const affectedClients = affectedBookings.map((booking) => booking.client).filter(Boolean);
    session.status = "cancelled";
    session.cancelledBy = req.user._id;
    session.cancelledByRole = req.user.role;
    session.cancelledAt = new Date();
    session.cancellationReason = String(req.body?.reason || "").trim();
    await session.save();
    await Booking.updateMany(
      { session: session._id, status: { $in: ["pending", "accepted", "waitlisted"] } },
      { $set: { status: "cancelled" } }
    );
    for (const booking of affectedBookings) {
      if (booking.creditStatus === "reserved") {
        await returnMembershipCredit(booking.membership);
        booking.creditStatus = "returned";
        booking.status = "cancelled";
        await booking.save();
      }
    }
    await emailGuestBookingCancellations(
      affectedBookings,
      session.cancelledAt,
      `session-cancelled:${session._id}:${session.cancelledAt.toISOString()}`
    );
    session.acceptedCount = 0;
    await session.save();
    await createAuditLog({
      actor: req.user, action: "SCHEDULE_CANCELLED",
      description: `Cancelled ${session.title}.`,
      entityType: "schedule", entityId: session._id, entityLabel: session.title,
      previousValue: previous, updatedValue: session,
      metadata: { affectedBookingCount: affectedBookings.length },
    });
    await announceSchedule(session, req.user._id, "cancelled", { clientsOverride: affectedClients });
    res.json({ session: (await populate(ClassSession.findById(session._id))).toPublic() });
  })
);

// GET /api/sessions/:id/bookings — the roster (owner instructor or admin).
router.get(
  "/:id/bookings",
  requireRole("instructor", "admin"),
  asyncHandler(async (req, res) => {
    const session = await ClassSession.findById(req.params.id);
    if (!session) throw new HttpError(404, "Session not found");
    if (!ownsOrAdmin(req, session)) throw new HttpError(403, "Not your session");
    const bookings = await Booking.find({ session: session._id })
      .populate("client", "name email picture phone")
      .sort("createdAt");
    res.json({
      bookings: bookings.map((bk) => bk.toPublic()),
      serverNow: new Date().toISOString(),
    });
  })
);

// PUT /api/sessions/:id/clients { clientIds: [] }
// Admin replaces the active roster in one validated batch. Booking records are
// retained as cancelled when a client is removed so schedule history is preserved.
router.put(
  "/:id/clients",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const session = await ClassSession.findById(req.params.id);
    if (!session) throw new HttpError(404, "Session not found");
    assertScheduleBookable(session);
    if (["cancelled", "completed"].includes(session.status)) {
      throw new HttpError(400, "Clients cannot be changed on a cancelled or completed schedule");
    }

    const submitted = req.body?.clientIds;
    if (!Array.isArray(submitted)) throw new HttpError(400, "clientIds must be an array");
    if (submitted.some((id) => !mongoose.isValidObjectId(id))) throw new HttpError(400, "One or more client IDs are invalid");
    const clientIds = [...new Set(submitted.map(String))];
    if (clientIds.length !== submitted.length) throw new HttpError(400, "A client cannot be assigned more than once");
    if (clientIds.length > session.capacity) {
      throw new HttpError(400, `Selected ${clientIds.length} clients, but this class has a maximum capacity of ${session.capacity}`);
    }

    const clients = await User.find({ _id: { $in: clientIds }, role: "client", active: true });
    if (clients.length !== clientIds.length) throw new HttpError(400, "One or more selected clients were not found or are inactive");

    for (const client of clients) {
      const clash = await findClientConflict({
        clientId: client._id,
        startAt: session.startAt,
        endAt: session.endAt,
        excludeSessionId: session._id,
      });
      if (clash) {
        const conflicting = clash.session;
        const when = conflicting?.startAt ? new Date(conflicting.startAt).toLocaleString() : "the selected time";
        throw new HttpError(409, `${client.name} already has a conflicting booking for "${conflicting?.title || "another class"}" on ${when}`);
      }
    }

    const existing = await Booking.find({ session: session._id });
    const previousRoster = existing.map((booking) => booking.toObject({ depopulate: true }));
    const desired = new Set(clientIds);
    const existingByClient = new Map(existing.map((booking) => [booking.client.toString(), booking]));
    const previouslyActive = new Set(existing
      .filter((booking) => ["pending", "accepted", "waitlisted"].includes(booking.status))
      .map((booking) => booking.client.toString()));
    const addedIds = clientIds.filter((id) => !previouslyActive.has(id));
    const removedIds = [...previouslyActive].filter((id) => !desired.has(id));
    const operations = [];
    const membershipByClient = new Map();
    const reservedMembershipIds = [];
    for (const clientId of addedIds) {
      const membership = await findEligibleMembership(clientId, session.title);
      const client = clients.find((item) => item._id.toString() === clientId);
      if (!membership) {
        throw new HttpError(402, `${client?.name || "A selected client"} does not have an active eligible plan credit.`);
      }
      membershipByClient.set(clientId, membership._id);
    }
    for (const clientId of addedIds) {
      const membershipId = membershipByClient.get(clientId);
      const client = clients.find((item) => item._id.toString() === clientId);
      const reserved = await reserveMembershipCredit(membershipId);
      if (!reserved) {
        for (const membershipId of reservedMembershipIds) await returnMembershipCredit(membershipId);
        throw new HttpError(409, `${client?.name || "A selected client"} no longer has an available plan credit.`);
      }
      reservedMembershipIds.push(membershipId);
    }

    for (const booking of existing) {
      if (!desired.has(booking.client.toString()) && ["pending", "accepted", "waitlisted"].includes(booking.status)) {
        operations.push({ updateOne: { filter: { _id: booking._id }, update: {
          $set: { status: "cancelled", creditStatus: booking.creditStatus === "reserved" ? "returned" : booking.creditStatus },
        } } });
      }
    }
    for (const clientId of clientIds) {
      const booking = existingByClient.get(clientId);
      if (booking) {
        if (booking.status !== "accepted") {
          operations.push({ updateOne: { filter: { _id: booking._id }, update: { $set: {
            status: "accepted", membership: membershipByClient.get(clientId), creditStatus: "reserved",
          } } } });
        }
      } else {
        operations.push({ insertOne: { document: {
          session: session._id, client: clientId, status: "accepted", note: "Assigned by admin",
          membership: membershipByClient.get(clientId), creditStatus: "reserved",
        } } });
      }
    }
    try {
      if (operations.length) await Booking.bulkWrite(operations, { ordered: true });
    } catch (error) {
      for (const membershipId of reservedMembershipIds) await returnMembershipCredit(membershipId);
      throw error;
    }
    for (const booking of existing.filter((item) => removedIds.includes(item.client.toString()))) {
      if (booking.creditStatus === "reserved") await returnMembershipCredit(booking.membership);
    }
    const removedGuestBookings = existing.filter((booking) =>
      removedIds.includes(booking.client.toString()) && booking.purchase);
    await emailGuestBookingCancellations(
      removedGuestBookings,
      new Date(),
      `roster-removed:${session._id}:${session.updatedAt.getTime()}`
    );
    session.acceptedCount = clientIds.length;
    await session.save();
    await createAuditLog({
      actor: req.user, action: "SCHEDULE_CLIENTS_UPDATED",
      description: `Updated client assignments for ${session.title}: ${addedIds.length} added, ${removedIds.length} removed.`,
      entityType: "schedule", entityId: session._id, entityLabel: session.title,
      previousValue: { bookings: previousRoster },
      updatedValue: { clientIds, acceptedCount: clientIds.length },
      metadata: { addedIds, removedIds },
    });

    const instructor = await User.findById(session.instructor);
    for (const clientId of addedIds) {
      const client = clients.find((item) => item._id.toString() === clientId);
      const eventKey = `schedule-roster:${session._id}:${clientId}:added:${session.updatedAt.getTime()}`;
      await createNotification({
        recipient: client, type: "CLIENT_ADDED_TO_SCHEDULE", title: "Added to Schedule",
        message: `You were added to ${session.title}.`,
        relatedUserId: client._id, relatedScheduleId: session._id, eventKey,
      });
      if (instructor && instructor._id.toString() !== req.user._id.toString()) {
        await createNotification({
          recipient: instructor, type: "CLIENT_ADDED_TO_SCHEDULE", title: "Client Added",
          message: `${client.name} was added to ${session.title}.`,
          relatedUserId: client._id, relatedScheduleId: session._id, eventKey,
        });
      }
      await notifyAdmins({
        type: "CLIENT_ADDED_TO_SCHEDULE", title: "Client Added",
        message: `${client.name} was added to ${session.title}.`,
        relatedUserId: client._id, relatedScheduleId: session._id, eventKey,
      }, req.user._id);
    }
    for (const clientId of removedIds) {
      const client = await User.findById(clientId);
      if (!client) continue;
      const eventKey = `schedule-roster:${session._id}:${clientId}:removed:${session.updatedAt.getTime()}`;
      await createNotification({
        recipient: client, type: "CLIENT_REMOVED_FROM_SCHEDULE", title: "Removed from Schedule",
        message: `You were removed from ${session.title}.`,
        relatedUserId: client._id, relatedScheduleId: session._id, eventKey,
      });
      if (instructor && instructor._id.toString() !== req.user._id.toString()) {
        await createNotification({
          recipient: instructor, type: "CLIENT_REMOVED_FROM_SCHEDULE", title: "Client Removed",
          message: `${client.name} was removed from ${session.title}.`,
          relatedUserId: client._id, relatedScheduleId: session._id, eventKey,
        });
      }
      await notifyAdmins({
        type: "CLIENT_REMOVED_FROM_SCHEDULE", title: "Client Removed",
        message: `${client.name} was removed from ${session.title}.`,
        relatedUserId: client._id, relatedScheduleId: session._id, eventKey,
      }, req.user._id);
    }

    const bookings = await Booking.find({ session: session._id, status: "accepted" })
      .populate("client", "name email picture phone active")
      .sort("createdAt");
    res.json({
      bookings: bookings.map((booking) => booking.toPublic()),
      assignedCount: bookings.length,
      remainingSlots: Math.max(0, session.capacity - bookings.length),
    });
  })
);

// Legacy Admin publish convenience. Instructor submissions must use /approve.
router.post(
  "/:id/publish",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const session = await ClassSession.findById(req.params.id);
    if (!session) throw new HttpError(404, "Session not found");
    if (!ownsOrAdmin(req, session)) throw new HttpError(403, "Not your session");
    const previous = session.toObject({ depopulate: true });
    if (!["cancelled", "completed"].includes(session.status)) {
      session.status = "published";
      session.isPublished = true;
      session.approvedBy = req.user._id;
      session.approvedAt = new Date();
    }
    await session.save();
    await createAuditLog({
      actor: req.user, action: "SCHEDULE_PUBLISHED",
      description: `Published ${session.title}.`,
      entityType: "schedule", entityId: session._id, entityLabel: session.title,
      previousValue: previous, updatedValue: session,
    });
    res.json({ session: (await populate(ClassSession.findById(session._id))).toPublic() });
  })
);

export default router;
