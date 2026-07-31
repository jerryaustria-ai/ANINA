export const SUPER_ADMIN_ROLE = "super_admin";

export function isSuperAdmin(role) {
  return role === SUPER_ADMIN_ROLE;
}

export function isAdminRole(role) {
  return role === "admin" || isSuperAdmin(role);
}

export function canManageUser(actorRole, targetRole) {
  return isSuperAdmin(actorRole) || !isSuperAdmin(targetRole);
}

