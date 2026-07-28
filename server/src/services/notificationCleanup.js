import { Notification } from "../models/Notification.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

export async function cleanupExpiredReadNotifications(now = new Date()) {
  const cutoff = new Date(now.getTime() - DAY_MS);
  const result = await Notification.deleteMany({
    isRead: true,
    readAt: { $ne: null, $lte: cutoff },
  });
  return result.deletedCount;
}

export function startNotificationCleanup() {
  const configuredInterval = Number(process.env.NOTIFICATION_CLEANUP_INTERVAL_MS);
  const intervalMs = Number.isFinite(configuredInterval) && configuredInterval > 0
    ? configuredInterval
    : DEFAULT_INTERVAL_MS;

  const timer = setInterval(async () => {
    try {
      const deleted = await cleanupExpiredReadNotifications();
      if (deleted > 0) {
        console.log(`✓ Deleted ${deleted} expired read notification${deleted === 1 ? "" : "s"}`);
      }
    } catch (error) {
      console.error("Notification cleanup failed:", error.message);
    }
  }, intervalMs);

  timer.unref();
  return timer;
}
