import crypto from "node:crypto";
import { User } from "../models/User.js";
import { hashPassword } from "./password.js";
import { sendAccountVerificationEmail } from "./email.js";

const cleanEmail = (value) => String(value || "").trim().toLowerCase();
const passwordStrongEnough = (password) =>
  password.length >= 12 &&
  /[a-z]/.test(password) &&
  /[A-Z]/.test(password) &&
  /\d/.test(password) &&
  /[^A-Za-z0-9]/.test(password);

export async function ensureDefaultSuperAdmin() {
  const email = cleanEmail(process.env.DEFAULT_SUPERADMIN_EMAIL);
  const password = String(process.env.DEFAULT_SUPERADMIN_PASSWORD || "");
  if (!email && !password) return { status: "not_configured" };
  if (!email || !password) {
    throw new Error("DEFAULT_SUPERADMIN_EMAIL and DEFAULT_SUPERADMIN_PASSWORD must both be configured");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("DEFAULT_SUPERADMIN_EMAIL is not a valid email address");
  }
  if (!passwordStrongEnough(password)) {
    throw new Error("DEFAULT_SUPERADMIN_PASSWORD must be at least 12 characters and include upper, lower, number, and symbol");
  }

  const existing = await User.findOne({ email })
    .select("+emailVerificationTokenHash +emailVerificationExpiresAt");
  if (existing) {
    if (existing.role !== "super_admin") {
      throw new Error("DEFAULT_SUPERADMIN_EMAIL already belongs to a non-Super-Admin account");
    }
    if (!existing.emailVerified) {
      const rawVerificationToken = crypto.randomBytes(32).toString("hex");
      existing.emailVerificationTokenHash = crypto.createHash("sha256")
        .update(rawVerificationToken).digest("hex");
      existing.emailVerificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await existing.save();
      const baseUrl = String(process.env.APP_BASE_URL || "").replace(/\/$/, "");
      if (!baseUrl) throw new Error("APP_BASE_URL is required for Super Admin email verification");
      const result = await sendAccountVerificationEmail({
        email: existing.email, name: existing.name,
        verificationUrl: `${baseUrl}/auth/verify-email#token=${encodeURIComponent(rawVerificationToken)}`,
      });
      if (result.status === "skipped") throw new Error("SMTP must be configured for Super Admin email verification");
    } else {
      await existing.save();
    }
    return { status: "existing" };
  }

  const rawVerificationToken = crypto.randomBytes(32).toString("hex");
  const verificationHash = crypto.createHash("sha256").update(rawVerificationToken).digest("hex");
  const user = await User.create({
    email,
    name: "Super Admin",
    role: "super_admin",
    active: true,
    passwordHash: await hashPassword(password),
    mustChangePassword: true,
    emailVerified: false,
    emailVerificationTokenHash: verificationHash,
    emailVerificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  const baseUrl = String(process.env.APP_BASE_URL || "").replace(/\/$/, "");
  if (!baseUrl) throw new Error("APP_BASE_URL is required for Super Admin email verification");
  const result = await sendAccountVerificationEmail({
    email: user.email,
    name: user.name,
    verificationUrl: `${baseUrl}/auth/verify-email#token=${encodeURIComponent(rawVerificationToken)}`,
  });
  if (result.status === "skipped") throw new Error("SMTP must be configured for Super Admin email verification");
  return { status: "created" };
}
