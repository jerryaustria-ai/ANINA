import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";

import { connectDB } from "./config/db.js";
import authRoutes from "./routes/auth.js";
import roomRoutes from "./routes/rooms.js";
import sessionRoutes from "./routes/sessions.js";
import bookingRoutes from "./routes/bookings.js";
import userRoutes from "./routes/users.js";
import tierRoutes from "./routes/tiers.js";
import membershipRoutes from "./routes/memberships.js";
import webhookRoutes from "./routes/webhooks.js";

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
app.use("/api/memberships", membershipRoutes);
app.use("/api/webhooks", webhookRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: "Not found" }));

// Central error handler
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  // Duplicate-key (e.g. double booking) surfaces as 409.
  if (err.code === 11000) return res.status(409).json({ error: "Duplicate entry" });
  res.status(status).json({ error: err.message || "Server error" });
});

connectDB(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/anina")
  .then(() => app.listen(PORT, () => console.log(`✓ ANINA API listening on http://localhost:${PORT}`)))
  .catch((err) => {
    console.error("Failed to start:", err.message);
    process.exit(1);
  });
