import mongoose from "mongoose";

export const ROLES = ["client", "instructor", "admin"];

const userSchema = new mongoose.Schema(
  {
    googleId: { type: String, index: true, sparse: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: "", select: false },
    name: { type: String, required: true, trim: true },
    picture: { type: String, default: "" },
    role: { type: String, enum: ROLES, default: "client", index: true },
    phone: { type: String, default: "" },
    active: { type: Boolean, default: true },

    // Instructor-only profile fields
    bio: { type: String, default: "" },
    specialties: { type: [String], default: [] },
  },
  { timestamps: true }
);

userSchema.methods.toPublic = function () {
  return {
    id: this._id,
    email: this.email,
    name: this.name,
    picture: this.picture,
    role: this.role,
    phone: this.phone,
    active: this.active,
    bio: this.bio,
    specialties: this.specialties,
  };
};

export const User = mongoose.model("User", userSchema);
