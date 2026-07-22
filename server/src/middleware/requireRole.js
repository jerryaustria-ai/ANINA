// Role guard. Use AFTER requireAuth. e.g. requireRole("admin") or
// requireRole("instructor", "admin").
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden — insufficient role" });
    }
    next();
  };
}
