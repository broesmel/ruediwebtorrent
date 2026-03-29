export function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ success: false, data: null, error: 'Forbidden' })
  }
  next()
}
