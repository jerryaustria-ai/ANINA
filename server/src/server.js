import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectDB } from "./config/db.js";
import authRoutes from "./routes/auth.js";
import roomRoutes from "./routes/rooms.js";
import sessionRoutes from "./routes/sessions.js";
import bookingRoutes from "./routes/bookings.js";
import userRoutes from "./routes/users.js";
import tierRoutes from "./routes/tiers.js";
import promoCodeRoutes from "./routes/promoCodes.js";
import membershipRoutes from "./routes/memberships.js";
import webhookRoutes from "./routes/webhooks.js";
import notificationRoutes from "./routes/notifications.js";
import auditLogRoutes from "./routes/auditLogs.js";
import guestCheckoutRoutes from "./routes/guestCheckout.js";
import checkInRoutes from "./routes/checkIn.js";
import reportRoutes from "./routes/reports.js";
import classDefinitionRoutes from "./routes/classDefinitions.js";
import { publicLandingRouter, superAdminRouter } from "./routes/landingCms.js";
import {
  cleanupExpiredReadNotifications,
  startNotificationCleanup,
} from "./services/notificationCleanup.js";
import { cleanupBlankCashConfirmationTokens } from "./services/cashEnrollmentMaintenance.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: (process.env.CLIENT_ORIGIN || "http://localhost:5173").split(","), credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.get("/api/health", (req, res) => res.json({ ok: true, service: "anina-booking", time: new Date().toISOString() }));

app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/users", userRoutes);
app.use("/api/tiers", tierRoutes);
app.use("/api/promo-codes", promoCodeRoutes);
app.use("/api/memberships", membershipRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/audit-logs", auditLogRoutes);
app.use("/api/guest-checkout", guestCheckoutRoutes);
app.use("/api/check-in", checkInRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/class-definitions", classDefinitionRoutes);
app.use("/api/public/landing", publicLandingRouter);
app.use("/api/super-admin", superAdminRouter);

// In production, serve the Vite build from this same web service. API typos
// remain JSON 404s; browser routes fall back to React's index.html.
const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(here, "../../app/dist");
app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
app.use(express.static(frontendDist));
app.get("*", (req, res) => res.sendFile(path.join(frontendDist, "index.html")));

// Central error handler
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  // Duplicate-key (e.g. double booking) surfaces as 409.
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0];
    if (field === "cashConfirmationTokenHash") {
      return res.status(409).json({
        error: "The cash confirmation token could not be prepared. Please retry the checkout.",
        code: "CASH_CONFIRMATION_TOKEN_CONFLICT",
      });
    }
    return res.status(409).json({
      error: "A duplicate record already exists.",
      code: "DUPLICATE_RECORD",
    });
  }
  res.status(status).json({ error: err.message || "Server error" });
});

connectDB(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/anina")
  .then(async () => {
    try {
      const cleaned = await cleanupBlankCashConfirmationTokens();
      if (cleaned) console.log(`✓ Removed ${cleaned} legacy blank cash confirmation token(s)`);
    } catch (error) {
      console.error("Cash confirmation token cleanup failed:", error.message);
    }
    try {
      await cleanupExpiredReadNotifications();
    } catch (error) {
      console.error("Initial notification cleanup failed:", error.message);
    }
    startNotificationCleanup();
    app.listen(PORT, () => console.log(`✓ ANINA API listening on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to start:", err.message);
    process.exit(1);
  });
