import { Router } from "express";
import { Booking } from "../models/Booking.js";
import { ClassSession } from "../models/ClassSession.js";
import { User } from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { claimSeat, releaseSeat } from "../services/capacity.js";
import {
  consumeReservedCredit,
  findEligibleMembership,
  reserveMembershipCredit,
  returnMembershipCredit,
} from "../services/membership.js";
import { findClientConflict } from "../services/conflict.js";
import { assertScheduleBookable } from "../services/scheduleTime.js";
import { createNotification, notifyAdmins } from "../services/notifications.js";
import { createAuditLog } from "../services/audit.js";
import { asyncHandler, HttpError } from "../utils/http.js";
import { GuestPurchase } from "../models/GuestPurchase.js";
import { sendPurchaseStatusEmailOnce } from "../services/email.js";

const router = Router();
router.use(requireAuth);

const isOwnerInstructor = (req, session) =>
  req.user.role === "admin" || session.instructor.toString() === req.user._id.toString();

async function finalizeEndedPresentBookings(filter = {}) {
  const candidates = await Booking.find({
    ...filter,
    creditStatus: "reserved",
    attendanceStatus: "present",
  }).populate("session");
  const ended = candidates.filter((booking) =>
    booking.session && new Date(booking.session.endAt) <= new Date());
  for (const booking of ended) {
    await consumeReservedCredit(booking.membership);
    booking.creditStatus = "consumed";
    booking.status = "attended";
    await booking.save();
  }
}

async function recordBookingAudit({ booking, session, actor, action, description, previousValue = null }) {
  const classSession = session?._id ? session : await ClassSession.findById(session);
  await createAuditLog({
    actor,
    action,
    description,
    entityType: "booking",
    entityId: booking._id,
    entityLabel: `${classSession?.title || "Booking"} — ${booking._id}`,
    previousValue,
    updatedValue: booking,
    metadata: {
      scheduleId: classSession?._id,
      scheduleTitle: classSession?.title,
      clientId: booking.client,
    },
  });
}

async function bookingRecipients(booking, session = booking.session) {
  const [client, instructor] = await Promise.all([
    User.findById(booking.client),
    User.findById(session.instructor),
  ]);
  return { client, instructor };
}

async function announceBooking(booking, session, actorId, action) {
  const { client, instructor } = await bookingRecipients(booking, session);
  const eventKey = `booking:${booking._id}:${action}:${booking.updatedAt?.getTime() || Date.now()}`;
  const className = session.title;
  const definitions = {
    requested: ["SPOT_REQUEST_SUBMITTED", "Spot Request Submitted", `Your request for ${className} was submitted.`],
    approved: ["BOOKING_APPROVED", "Booking Confirmed", `Your spot in ${className} has been confirmed.`],
    declined: ["BOOKING_DECLINED", "Request Declined", `Your request for ${className} was declined.`],
    cancelled: ["BOOKING_CANCELLED", "Booking Cancelled", `Your booking for ${className} was cancelled.`],
    waitlisted: ["BOOKING_STATUS_CHANGED", "Booking Waitlisted", `Your booking for ${className} was moved to the waitlist.`],
    rescheduled: ["BOOKING_STATUS_CHANGED", "Booking Rescheduled", `Your booking was moved to ${className}.`],
  };
  const [type, title, message] = definitions[action];
  await createNotification({
    recipient: client, type, title, message,
    relatedUserId: client?._id, relatedBookingId: booking._id, relatedScheduleId: session._id, eventKey,
  });
  if (instructor && instructor._id.toString() !== String(actorId)) {
    await createNotification({
      recipient: instructor,
      type: action === "requested" ? "NEW_SPOT_REQUEST" : "BOOKING_STATUS_CHANGED",
      title: action === "requested" ? "New Spot Request" : `Booking ${title.replace("Booking ", "")}`,
      message: `${client?.name || "A client"} ${action === "requested" ? "requested a spot in" : `had a booking ${action} for`} ${className}.`,
      relatedUserId: client?._id, relatedBookingId: booking._id, relatedScheduleId: session._id, eventKey,
    });
  }
  await notifyAdmins({
    type: action === "requested" ? "NEW_SPOT_REQUEST" : "BOOKING_STATUS_CHANGED",
    title: action === "requested" ? "New Spot Request" : title,
    message: `${client?.name || "A client"} — ${className}: ${action}.`,
    relatedUserId: client?._id, relatedBookingId: booking._id, relatedScheduleId: session._id, eventKey,
  }, actorId);
}

const sameClassName = (left, right) =>
  String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();

async function loadRescheduleContext(req) {
  const booking = await Booking.findById(req.params.id)
    .populate("session")
    .populate("membership");
  if (!booking) throw new HttpError(404, "Booking not found");
  if (req.user.role === "client" && String(booking.client) !== String(req.user._id)) {
    throw new HttpError(403, "You can only reschedule your own booking.");
  }
  if (req.user.role === "instructor" &&
      String(booking.session.instructor) !== String(req.user._id)) {
    throw new HttpError(403, "You can only reschedule bookings assigned to your classes.");
  }
  if (!["pending", "accepted", "waitlisted"].includes(booking.status)) {
    throw new HttpError(409, "This booking can no longer be rescheduled.");
  }
  const membership = booking.membership;
  const now = new Date();
  if (!membership || membership.status !== "active" ||
      (membership.currentPeriodEnd && membership.currentPeriodEnd < now)) {
    throw new HttpError(409, "The plan used for this booking is no longer active.");
  }
  return { booking, membership, now };
}

function validateReplacementSchedule({ booking, membership, target, now = new Date() }) {
  if (!sameClassName(target.title, booking.session.title)) {
    throw new HttpError(409, "The replacement schedule must be for the same class.");
  }
  if (target.status !== "published" || target.isPublished !== true) {
    throw new HttpError(409, "The replacement schedule is not published or available for booking.");
  }
  if (new Date(target.startAt) <= now) {
    throw new HttpError(409, "The replacement schedule has already started.");
  }
  const validFrom = membership.createdAt && new Date(membership.createdAt);
  const validUntil = membership.currentPeriodEnd && new Date(membership.currentPeriodEnd);
  if ((validFrom && new Date(target.startAt) < validFrom) ||
      (validUntil && new Date(target.startAt) > validUntil)) {
    throw new HttpError(409, "The replacement schedule is outside your plan validity period.");
  }
  if (target.acceptedCount >= target.capacity) {
    throw new HttpError(409, "The replacement schedule is already full.");
  }
}

async function transferBooking({ booking, target, req }) {
  await validateClientSlot({
    clientId: booking.client,
    session: target,
    excludeBookingId: booking._id,
  });
  const duplicate = await Booking.findOne({
    session: target._id,
    client: booking.client,
    _id: { $ne: booking._id },
  });
  if (duplicate) throw new HttpError(409, "The client already has a booking record for the replacement schedule.");

  const previous = booking.toObject({ depopulate: true });
  const previousSession = booking.session;
  const wasAccepted = booking.status === "accepted";
  if (wasAccepted) {
    const seat = await claimSeat(target._id);
    if (!seat) throw new HttpError(409, "The replacement schedule is already full.");
  }
  try {
    booking.session = target._id;
    booking.status = wasAccepted ? "accepted" : "pending";
    if (req.body.note !== undefined) booking.note = req.body.note;
    await booking.save();
  } catch (error) {
    if (wasAccepted) await releaseSeat(target._id);
    throw error;
  }
  if (wasAccepted) await releaseSeat(previousSession._id);
  await recordBookingAudit({
    booking,
    session: target,
    actor: req.user,
    action: "BOOKING_RESCHEDULED",
    description: `Rescheduled a booking from ${previousSession.title} to ${target.title}.`,
    previousValue: previous,
  });
  await announceBooking(booking, target, req.user._id, "rescheduled");
  const result = await Booking.findById(booking._id)
    .populate("client", "name email picture phone")
    .populate({ path: "session", populate: [
      { path: "instructor", select: "name email picture" },
      { path: "room", select: "name color location" },
    ] });
  return result;
}

async function validateClientSlot({ clientId, session, excludeBookingId }) {
  const client = await User.findOne({ _id: clientId, role: "client", active: true });
  if (!client) throw new HttpError(400, "Selected client was not found or is inactive");
  const clash = await findClientConflict({
    clientId,
    startAt: session.startAt,
    endAt: session.endAt,
    excludeSessionId: session._id,
    excludeBookingId,
  });
  if (clash) {
    throw new HttpError(409, `${client.name} already has a booking that overlaps this time`);
  }
  return client;
}

// POST /api/bookings  { sessionId, note }  — client requests a seat (pending).
router.post(
  "/",
  requireRole("client", "admin"),
  asyncHandler(async (req, res) => {
    const { sessionId, note } = req.body || {};

    const session = await ClassSession.findById(sessionId);
    if (!session) throw new HttpError(404, "Session not found");
    assertScheduleBookable(session);

    const clientId = req.user.role === "admin" && req.body.clientId ? req.body.clientId : req.user._id;
    const membership = await findEligibleMembership(clientId, session.title);
    if (!membership) {
      throw new HttpError(402, "An active eligible plan with remaining credit is required to book this class.");
    }
    await validateClientSlot({ clientId, session });
    const existing = await Booking.findOne({ session: sessionId, client: clientId });
    if (existing && !["cancelled", "declined"].includes(existing.status)) {
      throw new HttpError(409, "You already have a booking for this class");
    }

    let booking;
    const previous = existing?.toObject({ depopulate: true }) || null;
    if (existing) {
      existing.status = "pending";
      existing.note = note || "";
      existing.membership = membership._id;
      existing.creditStatus = "none";
      booking = await existing.save();
    } else {
      booking = await Booking.create({
        session: sessionId, client: clientId, membership: membership._id,
        note: note || "", status: "pending", creditStatus: "none",
      });
    }
    await recordBookingAudit({
      booking, session, actor: req.user,
      action: existing ? "BOOKING_REBOOKED" : "BOOKING_CREATED",
      description: `${req.user.name} ${existing ? "rebooked" : "created"} a booking request for ${session.title}.`,
      previousValue: previous,
    });
    await announceBooking(booking, session, req.user._id, "requested");
    res.status(201).json({ booking: booking.toPublic() });
  })
);

// Admin overview of every client booking, including its schedule.
router.get(
  "/",
  requireRole("admin"),
  asyncHandler(async (_req, res) => {
    await finalizeEndedPresentBookings();
    const bookings = await Booking.find()
      .populate("client", "name email picture phone active")
      .populate({ path: "session", populate: [{ path: "instructor", select: "name email picture" }, { path: "room", select: "name color location" }] })
      .sort("-createdAt");
    res.json({
      bookings: bookings.filter((b) => b.session).map((b) => b.toPublic()),
      serverNow: new Date().toISOString(),
    });
  })
);

// Admin can assign a client directly. The booking is accepted and occupies a seat.
router.post(
  "/admin",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { sessionId, clientId, note = "" } = req.body || {};
    if (!sessionId || !clientId) throw new HttpError(400, "sessionId and clientId are required");
    const session = await ClassSession.findById(sessionId);
    if (!session) throw new HttpError(404, "Session not found");
    assertScheduleBookable(session);
    const membership = await findEligibleMembership(clientId, session.title);
    if (!membership) {
      throw new HttpError(402, "This client does not have an active eligible plan with remaining credit.");
    }
    await validateClientSlot({ clientId, session });
    const existing = await Booking.findOne({ session: sessionId, client: clientId });
    if (existing && !["cancelled", "declined"].includes(existing.status)) {
      throw new HttpError(409, "This client is already assigned to the selected schedule");
    }

    const seat = await claimSeat(session._id);
    if (!seat) throw new HttpError(409, "This schedule is already full");
    let creditReserved = false;
    try {
      const reserved = await reserveMembershipCredit(membership._id);
      if (!reserved) throw new HttpError(409, "The selected plan no longer has an available credit.");
      creditReserved = true;
      const previous = existing?.toObject({ depopulate: true }) || null;
      const booking = existing || new Booking({ session: sessionId, client: clientId });
      booking.status = "accepted";
      booking.note = note;
      booking.membership = membership._id;
      booking.creditStatus = "reserved";
      await booking.save();
      await recordBookingAudit({
        booking, session, actor: req.user, action: "BOOKING_CREATED",
        description: `Assigned a client to ${session.title}.`,
        previousValue: previous,
      });
      await announceBooking(booking, session, req.user._id, "approved");
      await booking.populate("client", "name email picture phone");
      res.status(201).json({ booking: booking.toPublic() });
    } catch (error) {
      await releaseSeat(session._id);
      if (creditReserved) await returnMembershipCredit(membership._id);
      throw error;
    }
  })
);

// GET /api/bookings/mine — the signed-in client's bookings.
router.get(
  "/mine",
  asyncHandler(async (req, res) => {
    await finalizeEndedPresentBookings({ client: req.user._id });
    const bookings = await Booking.find({ client: req.user._id })
      .populate({ path: "session", populate: [{ path: "instructor", select: "name picture" }, { path: "room", select: "name color" }] })
      .sort("-createdAt");
    res.json({ bookings: bookings.map((b) => b.toPublic()) });
  })
);

// Helper for instructor/admin decisions on a booking.
async function loadForDecision(req) {
  const booking = await Booking.findById(req.params.id).populate("session");
  if (!booking) throw new HttpError(404, "Booking not found");
  if (!isOwnerInstructor(req, booking.session)) throw new HttpError(403, "Not your class");
  return booking;
}

// POST /api/bookings/:id/accept — claims a seat atomically; full class -> waitlist.
router.post(
  "/:id/accept",
  requireRole("instructor", "admin"),
  asyncHandler(async (req, res) => {
    const booking = await loadForDecision(req);
    assertScheduleBookable(booking.session);
    if (booking.status === "accepted") return res.json({ booking: booking.toPublic() });
    const previous = booking.toObject({ depopulate: true });

    const seat = await claimSeat(booking.session._id);
    if (!seat) {
      booking.status = "waitlisted";
      await booking.save();
      await recordBookingAudit({
        booking, session: booking.session, actor: req.user, action: "BOOKING_WAITLISTED",
        description: `Moved booking to the waitlist for ${booking.session.title}.`,
        previousValue: previous,
      });
      await announceBooking(booking, booking.session, req.user._id, "waitlisted");
      return res.status(200).json({ booking: booking.toPublic(), waitlisted: true, reason: "class full" });
    }
    const membership = await findEligibleMembership(booking.client, booking.session.title);
    if (!membership) {
      await releaseSeat(booking.session._id);
      throw new HttpError(402, "The client no longer has an eligible plan credit for this class.");
    }
    const reserved = await reserveMembershipCredit(membership._id);
    if (!reserved) {
      await releaseSeat(booking.session._id);
      throw new HttpError(409, "The client's plan no longer has an available credit.");
    }
    try {
      booking.status = "accepted";
      booking.membership = membership._id;
      booking.creditStatus = "reserved";
      await booking.save();
    } catch (error) {
      await releaseSeat(booking.session._id);
      await returnMembershipCredit(membership._id);
      throw error;
    }
    await recordBookingAudit({
      booking, session: booking.session, actor: req.user, action: "BOOKING_APPROVED",
      description: `Approved booking for ${booking.session.title}.`,
      previousValue: previous,
    });
    await announceBooking(booking, booking.session, req.user._id, "approved");
    res.json({ booking: booking.toPublic(), seatsLeft: Math.max(0, seat.capacity - seat.acceptedCount) });
  })
);

// Client/Admin: list only schedules that can replace this booking while using
// the same purchased plan credit.
router.get(
  "/:id/reschedule-options",
  requireRole("client", "instructor", "admin"),
  asyncHandler(async (req, res) => {
    const { booking, membership, now } = await loadRescheduleContext(req);
    const validFrom = membership.createdAt && new Date(membership.createdAt) > now
      ? new Date(membership.createdAt)
      : now;
    const query = {
      _id: { $ne: booking.session._id },
      title: booking.session.title,
      status: "published",
      isPublished: true,
      startAt: {
        $gt: validFrom,
        ...(membership.currentPeriodEnd ? { $lte: membership.currentPeriodEnd } : {}),
      },
      $expr: { $lt: ["$acceptedCount", "$capacity"] },
    };
    const candidates = await ClassSession.find(query)
      .populate("instructor", "name picture")
      .populate("room", "name color location")
      .sort("startAt");
    const targetIds = candidates.map((session) => session._id);
    const existingTargets = new Set((await Booking.find({
      client: booking.client,
      session: { $in: targetIds },
      _id: { $ne: booking._id },
    }).select("session")).map((item) => String(item.session)));

    const eligible = [];
    for (const session of candidates) {
      if (existingTargets.has(String(session._id))) continue;
      const clash = await findClientConflict({
        clientId: booking.client,
        startAt: session.startAt,
        endAt: session.endAt,
        excludeSessionId: booking.session._id,
        excludeBookingId: booking._id,
      });
      if (!clash) eligible.push(session);
    }
    res.json({
      schedules: eligible.map((session) => session.toPublic()),
      validity: {
        startsAt: membership.createdAt,
        endsAt: membership.currentPeriodEnd,
      },
    });
  })
);

router.post(
  "/:id/reschedule",
  requireRole("client", "instructor", "admin"),
  asyncHandler(async (req, res) => {
    const { booking, membership } = await loadRescheduleContext(req);
    const targetId = req.body?.sessionId;
    if (!targetId) throw new HttpError(400, "sessionId is required");
    if (String(targetId) === String(booking.session._id)) {
      throw new HttpError(409, "Please select a different schedule.");
    }
    const target = await ClassSession.findById(targetId);
    if (!target) throw new HttpError(404, "Replacement schedule not found");
    validateReplacementSchedule({ booking, membership, target });
    const result = await transferBooking({ booking, target, req });
    res.json({ booking: result.toPublic(), rescheduled: true });
  })
);

// Admin reschedules an individual booking to another available schedule.
router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { booking, membership } = await loadRescheduleContext(req);
    const targetId = req.body?.sessionId;
    if (!targetId) throw new HttpError(400, "sessionId is required");
    if (String(targetId) === String(booking.session._id)) {
      throw new HttpError(409, "Please select a different schedule.");
    }
    const target = await ClassSession.findById(targetId);
    if (!target) throw new HttpError(404, "Replacement schedule not found");
    validateReplacementSchedule({ booking, membership, target });
    const result = await transferBooking({ booking, target, req });
    res.json({ booking: result.toPublic(), rescheduled: true });
  })
);

// POST /api/bookings/:id/decline
router.post(
  "/:id/decline",
  requireRole("instructor", "admin"),
  asyncHandler(async (req, res) => {
    const booking = await loadForDecision(req);
    const previous = booking.toObject({ depopulate: true });
    if (booking.status === "accepted") await releaseSeat(booking.session._id);
    if (booking.creditStatus === "reserved") {
      await returnMembershipCredit(booking.membership);
      booking.creditStatus = "returned";
    }
    booking.status = "declined";
    await booking.save();
    await recordBookingAudit({
      booking, session: booking.session, actor: req.user, action: "BOOKING_DECLINED",
      description: `Declined booking for ${booking.session.title}.`,
      previousValue: previous,
    });
    await announceBooking(booking, booking.session, req.user._id, "declined");
    res.json({ booking: booking.toPublic() });
  })
);

// POST /api/bookings/:id/waitlist
router.post(
  "/:id/waitlist",
  requireRole("instructor", "admin"),
  asyncHandler(async (req, res) => {
    const booking = await loadForDecision(req);
    assertScheduleBookable(booking.session);
    const previous = booking.toObject({ depopulate: true });
    if (booking.status === "accepted") await releaseSeat(booking.session._id);
    if (booking.creditStatus === "reserved") {
      await returnMembershipCredit(booking.membership);
      booking.creditStatus = "returned";
    }
    booking.status = "waitlisted";
    await booking.save();
    await recordBookingAudit({
      booking, session: booking.session, actor: req.user, action: "BOOKING_WAITLISTED",
      description: `Moved booking to the waitlist for ${booking.session.title}.`,
      previousValue: previous,
    });
    await announceBooking(booking, booking.session, req.user._id, "waitlisted");
    res.json({ booking: booking.toPublic() });
  })
);

// POST /api/bookings/:id/attendance { status: "present" | "absent" | "no_show" }
router.post(
  "/:id/attendance",
  requireRole("instructor", "admin"),
  asyncHandler(async (req, res) => {
    const booking = await loadForDecision(req);
    const serverNow = new Date();
    if (serverNow < new Date(booking.session.startAt)) {
      throw new HttpError(409, "Attendance can only be recorded once the scheduled class has started.");
    }
    const classEnded = new Date(booking.session.endAt) <= serverNow;
    if (booking.session.status === "cancelled") {
      throw new HttpError(409, "Attendance cannot be recorded for a cancelled class.");
    }
    if (booking.status === "cancelled") throw new HttpError(409, "Attendance cannot be recorded for a cancelled booking.");
    if (booking.checkInUsedAt && req.user.role !== "admin") {
      throw new HttpError(409, "Attendance was confirmed by QR check-in and can only be changed by an Admin.");
    }
    if (!["accepted", "attended", "no_show"].includes(booking.status)) {
      throw new HttpError(409, "Attendance can only be recorded for a confirmed booking.");
    }
    const attendanceStatus = String(req.body?.status || "").toLowerCase();
    if (!["present", "absent", "no_show"].includes(attendanceStatus)) {
      throw new HttpError(400, "Attendance status must be Present, Absent, or No Show.");
    }

    const previous = booking.toObject({ depopulate: true });
    booking.attendanceStatus = attendanceStatus;
    booking.attendanceRecordedAt = new Date();
    booking.attendanceRecordedBy = req.user._id;
    // Before class end, attendance is provisional and the confirmed booking
    // remains active. Once the class has ended, persist the final outcome.
    if (classEnded) {
      booking.status = attendanceStatus === "present" ? "attended" : "no_show";
      if (attendanceStatus === "present" && booking.creditStatus === "reserved") {
        await consumeReservedCredit(booking.membership);
        booking.creditStatus = "consumed";
      }
    }
    await booking.save();
    await recordBookingAudit({
      booking,
      session: booking.session,
      actor: req.user,
      action: "BOOKING_ATTENDANCE_RECORDED",
      description: `Marked ${booking.session.title} attendance as ${attendanceStatus.replace("_", " ")}.`,
      previousValue: previous,
    });
    res.json({ booking: booking.toPublic() });
  })
);

// POST /api/bookings/:id/cancel — client cancels own booking (frees a seat).
router.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const booking = await Booking.findById(req.params.id).populate("session");
    if (!booking) throw new HttpError(404, "Booking not found");
    const isOwnerClient = booking.client.toString() === req.user._id.toString();
    if (!isOwnerClient && req.user.role !== "admin") throw new HttpError(403, "Not your booking");
    const previous = booking.toObject({ depopulate: true });

    if (booking.status === "accepted") await releaseSeat(booking.session._id);
    if (booking.creditStatus === "reserved") {
      await returnMembershipCredit(booking.membership);
      booking.creditStatus = "returned";
    }
    booking.status = "cancelled";
    await booking.save();
    await recordBookingAudit({
      booking, session: booking.session, actor: req.user, action: "BOOKING_CANCELLED",
      description: `Cancelled booking for ${booking.session.title}.`,
      previousValue: previous,
    });
    await announceBooking(booking, booking.session, req.user._id, "cancelled");
    if (booking.purchase) {
      const purchase = await GuestPurchase.findById(booking.purchase);
      if (purchase) {
        purchase.status = "cancelled";
        purchase.cancelledAt = new Date();
        await purchase.save();
        await sendPurchaseStatusEmailOnce(
          purchase._id,
          "booking_cancelled",
          `booking-cancelled:${booking._id}:${purchase.cancelledAt.toISOString()}`,
          { cancelledAt: purchase.cancelledAt }
        ).catch((error) => console.warn("Booking cancellation email failed:", error.message));
      }
    }
    res.json({ booking: booking.toPublic() });
  })
);

export default router;
