import { AuditLog } from "../models/AuditLog.js";

function safeSnapshot(value) {
  if (!value) return null;
  const source = typeof value.toObject === "function"
    ? value.toObject({ depopulate: true, versionKey: false })
    : value;
  const copy = JSON.parse(JSON.stringify(source));
  delete copy.passwordHash;
  if (typeof copy.picture === "string" && copy.picture.startsWith("data:")) {
    copy.picture = "[profile image omitted]";
  }
  return copy;
}

export async function createAuditLog({
  actor,
  action,
  description,
  entityType,
  entityId,
  entityLabel,
  previousValue = null,
  updatedValue = null,
  metadata = {},
  dbSession = null,
}) {
  if (!actor || !action || !entityId) return null;
  const payload = {
    actorId: actor._id,
    actorName: actor.name || actor.email || "Unknown user",
    actorRole: actor.role || "unknown",
    action,
    description,
    entityType,
    entityId: String(entityId),
    entityLabel: entityLabel || `${entityType} ${entityId}`,
    previousValue: safeSnapshot(previousValue),
    updatedValue: safeSnapshot(updatedValue),
    metadata: safeSnapshot(metadata) || {},
  };
  const [log] = await AuditLog.create([payload], dbSession ? { session: dbSession } : undefined);
  return log;
}
