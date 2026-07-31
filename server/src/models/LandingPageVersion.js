import mongoose from "mongoose";

const sectionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    type: { type: String, required: true },
    title: { type: String, default: "" },
    visible: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    content: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const landingPageVersionSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["draft", "published", "unpublished", "archived"],
      default: "draft",
      index: true,
    },
    hero: { type: mongoose.Schema.Types.Mixed, default: {} },
    sections: { type: [sectionSchema], default: [] },
    contact: { type: mongoose.Schema.Types.Mixed, default: {} },
    socialLinks: { type: mongoose.Schema.Types.Mixed, default: {} },
    businessHours: { type: String, default: "" },
    legalLinks: { type: mongoose.Schema.Types.Mixed, default: {} },
    seo: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    publishedAt: { type: Date, default: null },
    restoredFrom: { type: Number, default: null },
  },
  { timestamps: true, versionKey: false }
);

landingPageVersionSchema.index({ status: 1, updatedAt: -1 });

export const LandingPageVersion = mongoose.model("LandingPageVersion", landingPageVersionSchema);

