import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { migrateClassIds } from "../services/classIdMigration.js";

try {
  await connectDB(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/anina");
  await migrateClassIds();
  console.log("✓ Class ID relationships migrated successfully.");
} catch (error) {
  console.error("Class ID migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
