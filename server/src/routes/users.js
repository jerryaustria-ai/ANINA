import { Router } from "express";
import { User, ROLES } from "../models/User.js";
import { ClassSession } from "../models/ClassSession.js";
import { Booking } from "../models/Booking.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { hashPassword } from "../services/password.js";
import { createAuditLog } from "../services/audit.js";
import { asyncHandler, HttpError } from "../utils/http.js";

const router = Router();
router.use(requireAuth);

function validatePicture(picture) {
  const validData = /^data:image\/(jpeg|png|webp);base64,/.test(picture);
  const validUrl = /^https:\/\//i.test(picture);
  if (picture && ((!validData && !validUrl) || picture.length > 500_000)) {
    throw new HttpError(400, "Profile picture must be a JPEG, PNG, or WebP image under 500 KB");
  }
}

// Instructors list — used by client booking UI and admin assignment.
router.get(
  "/instructors",
  asyncHandler(async (req, res) => {
    const instructors = await User.find({ role: "instructor", active: true }).sort("name");
    res.json({ instructors: instructors.map((u) => u.toPublic()) });
  })
);

// Admin: list everyone (optional ?role= filter).
router.get(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.role) filter.role = req.query.role;
    const users = await User.find(filter).sort("name");
    res.json({ users: users.map((u) => u.toPublic()) });
  })
);

// Admin: provision a user with email/password. Google sign-in with the same
// verified email links to this record and preserves the assigned role.
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email || "").toLowerCase().trim();
    const { name, role = "client", phone, password, picture = "" } = req.body || {};
    if (!email) throw new HttpError(400, "email is required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Invalid email");
    if (typeof password !== "string" || password.length < 8) throw new HttpError(400, "Password must be at least 8 characters");
    if (!ROLES.includes(role)) throw new HttpError(400, "Invalid role");
    validatePicture(picture);
    if (await User.findOne({ email })) throw new HttpError(409, "A user with that email already exists");

    const user = await User.create({
      email,
      name: name?.trim() || email.split("@")[0],
      role,
      phone: phone || "",
      picture,
      passwordHash: await hashPassword(password),
    });
    await createAuditLog({
      actor: req.user, action: "USER_CREATED",
      description: `Created ${user.role} account for ${user.name}.`,
      entityType: "user", entityId: user._id, entityLabel: user.name,
      updatedValue: user,
    });
    res.status(201).json({ user: user.toPublic() });
  })
);

// Admin: view one user's complete public profile.
router.get(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw new HttpError(404, "User not found");
    res.json({ user: user.toPublic() });
  })
);

// Admin: update profile information and optionally reset the password.
router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id).select("+passwordHash");
    if (!user) throw new HttpError(404, "User not found");
    const previous = user.toObject({ depopulate: true });

    const body = req.body || {};
    if (body.email !== undefined) {
      const email = String(body.email).toLowerCase().trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Invalid email");
      const duplicate = await User.exists({ email, _id: { $ne: user._id } });
      if (duplicate) throw new HttpError(409, "A user with that email already exists");
      user.email = email;
    }
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new HttpError(400, "Name is required");
      user.name = name;
    }
    if (body.phone !== undefined) user.phone = String(body.phone).trim();
    if (body.bio !== undefined) user.bio = String(body.bio);
    if (body.specialties !== undefined) user.specialties = Array.isArray(body.specialties) ? body.specialties : [];
    if (body.picture !== undefined) {
      validatePicture(body.picture);
      user.picture = body.picture;
    }
    if (body.role !== undefined) {
      if (!ROLES.includes(body.role)) throw new HttpError(400, "Invalid role");
      if (user._id.equals(req.user._id) && body.role !== "admin") throw new HttpError(400, "You can't demote yourself");
      user.role = body.role;
    }
    if (body.active !== undefined) {
      if (user._id.equals(req.user._id) && !body.active) throw new HttpError(400, "You can't deactivate yourself");
      user.active = !!body.active;
    }
    if (body.password) {
      if (typeof body.password !== "string" || body.password.length < 8) throw new HttpError(400, "Password must be at least 8 characters");
      user.passwordHash = await hashPassword(body.password);
    }

    await user.save();
    await createAuditLog({
      actor: req.user, action: "USER_UPDATED",
      description: `Updated account information for ${user.name}.`,
      entityType: "user", entityId: user._id, entityLabel: user.name,
      previousValue: previous, updatedValue: user,
    });
    res.json({ user: user.toPublic() });
  })
);

// Admin: change a user's role (promote to instructor, etc.).
router.patch(
  "/:id/role",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { role } = req.body || {};
    if (!ROLES.includes(role)) throw new HttpError(400, "Invalid role");
    const user = await User.findById(req.params.id);
    if (!user) throw new HttpError(404, "User not found");
    if (user._id.toString() === req.user._id.toString() && role !== "admin") {
      throw new HttpError(400, "You can't demote yourself");
    }
    const previousRole = user.role;
    user.role = role;
    await user.save();
    await createAuditLog({
      actor: req.user, action: "USER_ROLE_CHANGED",
      description: `Changed ${user.name}'s role from ${previousRole} to ${role}.`,
      entityType: "user", entityId: user._id, entityLabel: user.name,
      previousValue: { role: previousRole }, updatedValue: { role },
    });
    res.json({ user: user.toPublic() });
  })
);

// Admin: activate/deactivate a user.
router.patch(
  "/:id/active",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw new HttpError(404, "User not found");
    if (user._id.toString() === req.user._id.toString() && !req.body.active) {
      throw new HttpError(400, "You can't deactivate yourself");
    }
    const previousActive = user.active;
    user.active = !!req.body.active;
    await user.save();
    await createAuditLog({
      actor: req.user, action: user.active ? "USER_ACTIVATED" : "USER_DEACTIVATED",
      description: `${user.active ? "Activated" : "Deactivated"} ${user.name}'s account.`,
      entityType: "user", entityId: user._id, entityLabel: user.name,
      previousValue: { active: previousActive }, updatedValue: { active: user.active },
    });
    res.json({ user: user.toPublic() });
  })
);

// Admin: inspect historical records that prevent permanent user deletion.
router.get(
  "/:id/dependencies",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw new HttpError(404, "User not found");

    const [sessions, bookings] = await Promise.all([
      ClassSession.find({ instructor: user._id })
        .populate("instructor", "name email picture")
        .populate("room", "name color location")
        .sort("-startAt"),
      Booking.find({ client: user._id })
        .populate("client", "name email picture")
        .populate({
          path: "session",
          populate: [{ path: "instructor", select: "name email picture" }, { path: "room", select: "name color location" }],
        })
        .sort("-createdAt"),
    ]);

    const sessionIds = sessions.map((session) => session._id);
    const rosterBookings = sessionIds.length
      ? await Booking.find({ session: { $in: sessionIds } }).populate("client", "name email picture").sort("createdAt")
      : [];
    const rosterBySession = new Map();
    rosterBookings.forEach((booking) => {
      const key = booking.session.toString();
      if (!rosterBySession.has(key)) rosterBySession.set(key, []);
      rosterBySession.get(key).push(booking.toPublic());
    });

    res.json({
      user: user.toPublic(),
      hasDependencies: sessions.length > 0 || bookings.length > 0,
      sessions: sessions.map((session) => ({
        ...session.toPublic(),
        bookings: rosterBySession.get(session._id.toString()) || [],
      })),
      bookings: bookings.filter((booking) => booking.session).map((booking) => booking.toPublic()),
    });
  })
);

// Admin: permanently delete a user — only when they hold no data. Users with
// sessions or bookings should be deactivated instead (to preserve history).
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw new HttpError(404, "User not found");
    if (user._id.toString() === req.user._id.toString()) throw new HttpError(400, "You can't delete yourself");

    const [sessions, bookings] = await Promise.all([
      ClassSession.countDocuments({ instructor: user._id }),
      Booking.countDocuments({ client: user._id }),
    ]);
    if (sessions || bookings) {
      throw new HttpError(409, "This user has existing classes or bookings and cannot be deleted. Please deactivate the user instead.");
    }
    const snapshot = user.toObject({ depopulate: true });
    await createAuditLog({
      actor: req.user, action: "USER_DELETED",
      description: `Permanently deleted ${user.name}'s account.`,
      entityType: "user", entityId: user._id, entityLabel: user.name,
      previousValue: snapshot,
    });
    await user.deleteOne();
    res.json({ ok: true, deleted: true });
  })
);

// Update own profile. Role, account status, and permissions remain Admin-only.
router.patch(
  "/me",
  asyncHandler(async (req, res) => {
    const previous = req.user.toObject({ depopulate: true });
    const { name, phone, picture, bio, specialties } = req.body || {};
    if (name !== undefined) {
      const cleanName = String(name).trim();
      if (!cleanName) throw new HttpError(400, "Name is required");
      req.user.name = cleanName;
    }
    if (phone !== undefined) req.user.phone = phone;
    if (picture !== undefined) {
      validatePicture(picture);
      req.user.picture = picture;
    }
    if (bio !== undefined) req.user.bio = bio;
    if (specialties !== undefined) req.user.specialties = specialties;
    await req.user.save();
    await createAuditLog({
      actor: req.user, action: "PROFILE_UPDATED",
      description: `${req.user.name} updated their profile.`,
      entityType: "user", entityId: req.user._id, entityLabel: req.user.name,
      previousValue: previous, updatedValue: req.user,
    });
    res.json({ user: req.user.toPublic() });
  })
);

export default router;
