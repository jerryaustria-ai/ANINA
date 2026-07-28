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
  membershipAllowsClass,
  reserveMembershipCredit,
  returnMembershipCredit,
} from "../services/membership.js";
import { findClientConflict } from "../services/conflict.js";
import { assertScheduleBookable } from "../services/scheduleTime.js";
import { createNotification, notifyAdmins } from "../services/notifications.js";
import { createAuditLog } from "../services/audit.js";
import { asyncHandler, HttpError } from "../utils/http.js";
import { GuestPurchase } from "../models/GuestPurchase.js";
import { Membership } from "../models/Membership.js";
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

// Admin reschedules an individual booking to another available schedule.
router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const booking = await Booking.findById(req.params.id).populate("session");
    if (!booking) throw new HttpError(404, "Booking not found");
    const targetId = req.body?.sessionId;
    if (!targetId) throw new HttpError(400, "sessionId is required");
    if (targetId === booking.session._id.toString()) return res.json({ booking: booking.toPublic() });
    const previous = booking.toObject({ depopulate: true });
    const previousSessionTitle = booking.session.title;

    const target = await ClassSession.findById(targetId);
    if (!target) throw new HttpError(404, "Target schedule not found");
    assertScheduleBookable(target);
    await validateClientSlot({ clientId: booking.client, session: target, excludeBookingId: booking._id });
    const duplicate = await Booking.findOne({ session: target._id, client: booking.client, _id: { $ne: booking._id } });
    if (duplicate) throw new HttpError(409, "Client already has a booking record for the target schedule");

    const wasAccepted = booking.status === "accepted";
    let replacementMembership = null;
    let replacementCreditReserved = false;
    let currentMembership = null;
    if (wasAccepted && booking.creditStatus === "reserved" && booking.membership) {
      currentMembership = await Membership.findById(booking.membership);
      if (!currentMembership || !membershipAllowsClass(currentMembership, target.title)) {
        replacementMembership = await findEligibleMembership(booking.client, target.title);
        if (!replacementMembership) {
          throw new HttpError(402, "The client does not have an active plan that covers the target class.");
        }
      }
    }
    if (wasAccepted) {
      const seat = await claimSeat(target._id);
      if (!seat) throw new HttpError(409, "Target schedule is already full");
      if (replacementMembership) {
        const reserved = await reserveMembershipCredit(replacementMembership._id);
        if (!reserved) {
          await releaseSeat(target._id);
          throw new HttpError(409, "The client's target plan no longer has an available credit.");
        }
        replacementCreditReserved = true;
      }
    }
    const oldSessionId = booking.session._id;
    try {
      booking.session = target._id;
      booking.status = wasAccepted ? "accepted" : "pending";
      if (replacementMembership) {
        booking.membership = replacementMembership._id;
        booking.creditStatus = "reserved";
      }
      if (req.body.note !== undefined) booking.note = req.body.note;
      await booking.save();
      await recordBookingAudit({
        booking, session: target, actor: req.user, action: "BOOKING_RESCHEDULED",
        description: `Rescheduled a booking from ${previousSessionTitle} to ${target.title}.`,
        previousValue: previous,
      });
      if (wasAccepted) await releaseSeat(oldSessionId);
      if (replacementMembership && currentMembership) await returnMembershipCredit(currentMembership._id);
      await announceBooking(booking, target, req.user._id, wasAccepted ? "approved" : "requested");
      const result = await Booking.findById(booking._id)
        .populate("client", "name email picture phone")
        .populate({ path: "session", populate: [{ path: "instructor", select: "name email picture" }, { path: "room", select: "name color location" }] });
      res.json({ booking: result.toPublic(), rescheduled: true });
    } catch (error) {
      if (wasAccepted) await releaseSeat(target._id);
      if (replacementCreditReserved) await returnMembershipCredit(replacementMembership._id);
      throw error;
    }
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
