import 'dotenv/config'
import { Router } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { createUser, getUserByEmail } from '../../db/repositories/userRepo.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'
const JWT_EXPIRY  = process.env.JWT_EXPIRY  || '7d'
const BCRYPT_COST = 12

const ok   = (res, data, status = 200) =>
  res.status(status).json({ success: true, data, error: null })
const fail = (res, error, status) =>
  res.status(status).json({ success: false, data: null, error })

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, isAdmin: user.isAdmin },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: JWT_EXPIRY }
  )
}

function safeUser(user) {
  return { id: user.id, email: user.email, isAdmin: user.isAdmin }
}

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {}

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return fail(res, 'Valid email is required', 400)
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return fail(res, 'Password must be at least 8 characters', 400)
    }

    const existing = await getUserByEmail(email)
    if (existing) return fail(res, 'Email already registered', 409)

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST)
    const user = await createUser({ email: email.toLowerCase(), passwordHash })

    ok(res, { token: signToken(user), user: safeUser(user) }, 201)
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {}

    if (!email || !password) return fail(res, 'Email and password are required', 400)

    const user = await getUserByEmail(email.toLowerCase())
    if (!user) return fail(res, 'Invalid credentials', 401)

    const match = await bcrypt.compare(password, user.passwordHash)
    if (!match) return fail(res, 'Invalid credentials', 401)

    ok(res, { token: signToken(user), user: safeUser(user) })
  } catch (err) {
    next(err)
  }
})

// GET /api/auth/me — returns the authenticated user
router.get('/me', authenticate, (req, res) => {
  ok(res, req.user)
})

export default router
