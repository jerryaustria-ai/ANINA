import { Router } from "express";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { User } from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { verifyPassword } from "../services/password.js";
import { hashPassword } from "../services/password.js";
import { asyncHandler, HttpError } from "../utils/http.js";
import { notifyAdmins } from "../services/notifications.js";

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

async function notifyRegistration(user) {
  await notifyAdmins({
    type: "NEW_USER_REGISTRATION",
    title: "New User Registration",
    message: `${user.name} created a ${user.role} account.`,
    relatedUserId: user._id,
    eventKey: `user-registration:${user._id}`,
  }, user._id);
}

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const email = cleanEmail(req.body?.email);
    const name = String(req.body?.name || "").trim();
    const phone = String(req.body?.phone || "").trim();
    const password = req.body?.password;
    if (!name || !email || typeof password !== "string") {
      throw new HttpError(400, "Name, email, and password are required.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Invalid email");
    if (password.length < 8) throw new HttpError(400, "Password must be at least 8 characters");
    if (await User.exists({ email })) throw new HttpError(409, "An account with this email already exists.");
    const user = await User.create({
      name, email, phone, role: "client", active: true,
      passwordHash: await hashPassword(password),
    });
    await notifyRegistration(user);
    res.status(201).json({ token: signToken(user), user: user.toPublic() });
  })
);

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
      await notifyRegistration(user);
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

router.post(
  "/facebook",
  asyncHandler(async (req, res) => {
    const accessToken = String(req.body?.accessToken || "");
    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    if (!accessToken) throw new HttpError(400, "Missing Facebook access token");
    if (!appId || !appSecret) throw new HttpError(503, "Facebook login is not configured.");
    const appToken = `${appId}|${appSecret}`;
    const debugResponse = await fetch(`https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appToken)}`);
    const debug = await debugResponse.json();
    if (!debugResponse.ok || !debug.data?.is_valid || String(debug.data.app_id) !== String(appId)) {
      throw new HttpError(401, "Could not verify Facebook sign-in.");
    }
    const profileResponse = await fetch(`https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${encodeURIComponent(accessToken)}`);
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile.email) {
      throw new HttpError(400, "Your Facebook account must share a verified email address.");
    }
    const email = cleanEmail(profile.email);
    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({
        email,
        name: profile.name || email.split("@")[0],
        picture: profile.picture?.data?.url || "",
        role: "client",
      });
      await notifyRegistration(user);
    } else {
      if (!user.active) throw new HttpError(403, "This account is inactive.");
      user.name = profile.name || user.name;
      user.picture = profile.picture?.data?.url || user.picture;
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
      await notifyAdmins({
        type: "NEW_USER_REGISTRATION",
        title: "New User Registration",
        message: `${user.name} created a ${user.role} account.`,
        relatedUserId: user._id,
        eventKey: `user-registration:${user._id}`,
      }, user._id);
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
