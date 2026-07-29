import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { migrateClassCodes } from "../services/classCodeMigration.js";

try {
  await connectDB(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/anina");
  await migrateClassCodes();
  console.log("✓ Class Codes backfilled successfully.");
} catch (error) {
  console.error("Class Code migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
