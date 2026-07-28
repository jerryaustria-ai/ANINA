import mongoose from "mongoose";

const classDefinitionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, unique: true, index: true },
    description: { type: String, default: "" },
    type: { type: String, enum: ["group", "private"], default: "group" },
    defaultRoom: { type: mongoose.Schema.Types.ObjectId, ref: "Room", default: null },
    defaultCapacity: { type: Number, min: 1, default: 8 },
    defaultMinToRun: { type: Number, min: 1, default: 1 },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

classDefinitionSchema.methods.toPublic = function () {
  const room = this.defaultRoom?.toPublic ? this.defaultRoom.toPublic() : this.defaultRoom;
  return {
    id: this._id,
    title: this.title,
    description: this.description,
    type: this.type,
    defaultRoom: room,
    defaultCapacity: this.defaultCapacity,
    defaultMinToRun: this.defaultMinToRun,
    active: this.active,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const ClassDefinition = mongoose.model("ClassDefinition", classDefinitionSchema);
