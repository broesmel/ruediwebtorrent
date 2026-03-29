import jwt from 'jsonwebtoken'
import 'dotenv/config'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'

/**
 * Verifies the Bearer JWT in Authorization header.
 * On success: sets req.user = { id, email, isAdmin } and calls next().
 * On failure: responds 401.
 */
export function authenticate(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, data: null, error: 'Unauthenticated' })
  }

  const token = header.slice(7)
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    req.user = { id: payload.id, email: payload.email, isAdmin: payload.isAdmin }
    next()
  } catch {
    res.status(401).json({ success: false, data: null, error: 'Invalid or expired token' })
  }
}
