import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { User } from "../models/User.js";
import { Room } from "../models/Room.js";
import { ClassSession } from "../models/ClassSession.js";
import { Booking } from "../models/Booking.js";
import { MembershipTier } from "../models/MembershipTier.js";
import { Membership } from "../models/Membership.js";

// Seeds sample rooms, users (admin/instructors/clients) and a week of classes
// so the dashboards have something to show immediately. Idempotent-ish: it
// clears sample data first. Safe for local dev only.
async function run() {
  await connectDB(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/anina");

  console.log("Clearing existing data…");
  await Promise.all([User.deleteMany({}), Room.deleteMany({}), ClassSession.deleteMany({}), Booking.deleteMany({}),
    MembershipTier.deleteMany({}), Membership.deleteMany({})]);

  const adminEmail = (process.env.ADMIN_EMAILS || "patrick.ong.wong@gmail.com").split(",")[0].trim().toLowerCase();

  const [admin, joycee, maya, client1, client2, client3, client4] = await User.create([
    { email: adminEmail, name: "ANINA Admin", role: "admin" },
    { email: "joycee@aninasanctuary.ph", name: "Joycee", role: "instructor", specialties: ["Postpartum", "Mobility"] },
    { email: "maya@aninasanctuary.ph", name: "Maya", role: "instructor", specialties: ["Strength", "Recovery"] },
    { email: "client1@example.com", name: "Ana Cruz", role: "client" },
    { email: "client2@example.com", name: "Bea Santos", role: "client" },
    { email: "client3@example.com", name: "Carla Reyes", role: "client" },
    { email: "client4@example.com", name: "Dina Lim", role: "client" },
  ]);

  const [studioA, studioB, privateRoom] = await Room.create([
    { name: "Studio A", maxCapacity: 12, location: "Ground floor", color: "#8a9a5b" },
    { name: "Studio B", maxCapacity: 8, location: "Second floor", color: "#c98a5b" },
    { name: "Private Room", maxCapacity: 2, location: "Second floor", color: "#6b8caf" },
  ]);

  // Build a few classes across the next few days. Times are set relative to
  // "today" at fixed hours (Date.now is available in a normal Node script).
  const at = (dayOffset, hour, mins = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, mins, 0, 0);
    return d;
  };
  const plus = (date, hours) => new Date(date.getTime() + hours * 3600 * 1000);

  const s1start = at(1, 9);
  const s2start = at(1, 11);
  const s3start = at(2, 18);
  const s4start = at(3, 10);

  const [s1, s2, s3, s4] = await ClassSession.create([
    { title: "Postpartum Recovery Flow", type: "group", instructor: joycee._id, room: studioA._id, startAt: s1start, endAt: plus(s1start, 1), capacity: 12, minToRun: 4, status: "open" },
    { title: "Mobility & Core", type: "group", instructor: joycee._id, room: studioB._id, startAt: s2start, endAt: plus(s2start, 1), capacity: 8, minToRun: 3, status: "open" },
    { title: "Strength Basics", type: "group", instructor: maya._id, room: studioA._id, startAt: s3start, endAt: plus(s3start, 1), capacity: 12, minToRun: 5, status: "open" },
    { title: "Private Session", type: "private", instructor: maya._id, room: privateRoom._id, startAt: s4start, endAt: plus(s4start, 1), capacity: 1, minToRun: 1, status: "open" },
  ]);

  // A few bookings; accept two into s1 so it shows headcount progress.
  await Booking.create([
    { session: s1._id, client: client1._id, status: "accepted" },
    { session: s1._id, client: client2._id, status: "accepted" },
    { session: s1._id, client: client3._id, status: "pending" },
    { session: s2._id, client: client4._id, status: "pending" },
    { session: s4._id, client: client1._id, status: "pending" },
  ]);
  s1.acceptedCount = 2;
  await s1.save();

  console.log("\n✓ Seed complete");
  console.log(`  Admin:       ${adminEmail}`);
  console.log("  Instructors: joycee@aninasanctuary.ph, maya@aninasanctuary.ph");
  console.log("  Clients:     client1..4@example.com");
  console.log("  Rooms:       Studio A (12), Studio B (8), Private Room (2)");
  console.log("  Sessions:    4 classes seeded over the next 3 days");
  console.log("\nUse ALLOW_DEV_LOGIN=true and POST /api/auth/dev-login { email } to sign in as any of them.\n");

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
