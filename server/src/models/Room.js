import mongoose from "mongoose";

const roomSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    maxCapacity: { type: Number, required: true, min: 1 },
    location: { type: String, default: "" },
    // Calendar colour so admin can tell rooms apart at a glance.
    color: { type: String, default: "#8a9a5b" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

roomSchema.methods.toPublic = function () {
  return {
    id: this._id,
    name: this.name,
    maxCapacity: this.maxCapacity,
    location: this.location,
    color: this.color,
    active: this.active,
  };
};

export const Room = mongoose.model("Room", roomSchema);
