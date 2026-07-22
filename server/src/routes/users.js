import { Router } from "express";
import { User, ROLES } from "../models/User.js";
import { ClassSession } from "../models/ClassSession.js";
import { Booking } from "../models/Booking.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { hashPassword } from "../services/password.js";
import { asyncHandler, HttpError } from "../utils/http.js";

const router = Router();
router.use(requireAuth);

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
    if (picture && (!/^data:image\/(jpeg|png|webp);base64,/.test(picture) || picture.length > 500_000)) {
      throw new HttpError(400, "Profile picture must be a JPEG, PNG, or WebP image under 500 KB");
    }
    if (await User.findOne({ email })) throw new HttpError(409, "A user with that email already exists");

    const user = await User.create({
      email,
      name: name?.trim() || email.split("@")[0],
      role,
      phone: phone || "",
      picture,
      passwordHash: await hashPassword(password),
    });
    res.status(201).json({ user: user.toPublic() });
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
    user.role = role;
    await user.save();
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
    user.active = !!req.body.active;
    await user.save();
    res.json({ user: user.toPublic() });
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
      throw new HttpError(409, "This user has classes or bookings — deactivate them instead of deleting");
    }
    await user.deleteOne();
    res.json({ ok: true, deleted: true });
  })
);

// Update own profile (phone, and instructor bio/specialties).
router.patch(
  "/me",
  asyncHandler(async (req, res) => {
    const { phone, bio, specialties } = req.body || {};
    if (phone !== undefined) req.user.phone = phone;
    if (bio !== undefined) req.user.bio = bio;
    if (specialties !== undefined) req.user.specialties = specialties;
    await req.user.save();
    res.json({ user: req.user.toPublic() });
  })
);

export default router;
