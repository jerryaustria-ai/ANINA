import { Router } from "express";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { User } from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { verifyPassword } from "../services/password.js";
import { asyncHandler, HttpError } from "../utils/http.js";

const router = Router();

function adminEmails() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

// POST /api/auth/login { email, password }
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const email = cleanEmail(req.body?.email);
    const password = req.body?.password;
    if (!email || typeof password !== "string") throw new HttpError(400, "Email and password are required");

    const user = await User.findOne({ email }).select("+passwordHash");
    if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
      throw new HttpError(401, "Invalid email or password");
    }
    res.json({ token: signToken(user), user: user.toPublic() });
  })
);

// POST /api/auth/google  { credential }  — Google ID token from the frontend.
// Verifies it, upserts the user, and returns our own session token.
router.post(
  "/google",
  asyncHandler(async (req, res) => {
    const { credential } = req.body || {};
    if (!credential) throw new HttpError(400, "Missing Google credential");

    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    let payload;
    try {
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch {
      throw new HttpError(401, "Could not verify Google sign-in");
    }
    if (!payload?.email || !payload.email_verified) {
      throw new HttpError(401, "Google account email not verified");
    }

    const email = payload.email.toLowerCase();
    const isAdmin = adminEmails().includes(email);

    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({
        googleId: payload.sub,
        email,
        name: payload.name || email.split("@")[0],
        picture: payload.picture || "",
        role: isAdmin ? "admin" : "client",
      });
    } else {
      // Keep profile fresh; promote to admin if now on the allowlist.
      user.googleId = user.googleId || payload.sub;
      user.name = payload.name || user.name;
      user.picture = payload.picture || user.picture;
      if (isAdmin && user.role !== "admin") user.role = "admin";
      await user.save();
    }

    res.json({ token: signToken(user), user: user.toPublic() });
  })
);

// POST /api/auth/dev-login  { email }  — DEV ONLY shortcut so the app is
// testable before a Google OAuth client id exists. Enabled only when
// ALLOW_DEV_LOGIN=true. Signs in an existing (e.g. seeded) user by email.
router.post(
  "/dev-login",
  asyncHandler(async (req, res) => {
    if (process.env.ALLOW_DEV_LOGIN !== "true") throw new HttpError(404, "Not found");
    const email = String(req.body?.email || "").toLowerCase().trim();
    if (!email) throw new HttpError(400, "email required");
    let user = await User.findOne({ email });
    if (!user) {
      const isAdmin = adminEmails().includes(email);
      user = await User.create({ email, name: email.split("@")[0], role: isAdmin ? "admin" : "client" });
    }
    res.json({ token: signToken(user), user: user.toPublic() });
  })
);

// GET /api/auth/me — current user from the session token.
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user.toPublic() });
  })
);

export default router;
