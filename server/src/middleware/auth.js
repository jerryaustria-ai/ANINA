import jwt from "jsonwebtoken";
import { User } from "../models/User.js";

// Verifies our own session JWT (issued after Google sign-in) and loads the user.
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Not authenticated" });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user || !user.active) return res.status(401).json({ error: "Account not found or disabled" });

    req.user = user;
    const securityRoute = req.originalUrl.startsWith("/api/auth/me") ||
      req.originalUrl.startsWith("/api/auth/change-password") ||
      req.originalUrl.startsWith("/api/auth/resend-verification");
    if (user.mustChangePassword && !securityRoute) {
      return res.status(403).json({
        error: "You must change your temporary password before continuing.",
        code: "PASSWORD_CHANGE_REQUIRED",
      });
    }
    if (!user.emailVerified && !securityRoute) {
      return res.status(403).json({
        error: "Verify your email address before continuing.",
        code: "EMAIL_VERIFICATION_REQUIRED",
      });
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

// Loads the current user when a token is present, while keeping public routes public.
export async function optionalAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return next();

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user || !user.active) return res.status(401).json({ error: "Account not found or disabled" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}
