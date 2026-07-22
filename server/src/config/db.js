import mongoose from "mongoose";

export async function connectDB(uri) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8000,
    ...(process.env.MONGO_DB_NAME ? { dbName: process.env.MONGO_DB_NAME } : {}),
  });
  const { host, port, name } = mongoose.connection;
  console.log(`✓ MongoDB connected → ${host}:${port}/${name}`);
  return mongoose.connection;
}
