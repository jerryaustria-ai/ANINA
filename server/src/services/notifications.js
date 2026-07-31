import { Notification } from "../models/Notification.js";
import { User } from "../models/User.js";

export async function createNotification({
  recipient,
  type,
  title,
  message,
  relatedUserId = null,
  relatedBookingId = null,
  relatedScheduleId = null,
  eventKey,
}) {
  if (!recipient?._id || !recipient.active) return null;
  const dedupeKey = `${eventKey}:${recipient._id}:${type}`;
  try {
    return await Notification.create({
      recipientId: recipient._id,
      recipientRole: recipient.role,
      type,
      title,
      message,
      relatedUserId,
      relatedBookingId,
      relatedScheduleId,
      dedupeKey,
    });
  } catch (error) {
    if (error.code === 11000) return null;
    console.warn("Notification creation failed:", error.message);
    return null;
  }
}

export async function notifyMany(recipients, details) {
  const unique = [...new Map(recipients.filter(Boolean).map((user) => [user._id.toString(), user])).values()];
  return Promise.all(unique.map((recipient) => createNotification({ recipient, ...details })));
}

export async function activeAdmins(excludeId = null) {
  const query = { role: { $in: ["admin", "super_admin"] }, active: true };
  if (excludeId) query._id = { $ne: excludeId };
  return User.find(query);
}

export async function notifyAdmins(details, excludeId = null) {
  return notifyMany(await activeAdmins(excludeId), details);
}
