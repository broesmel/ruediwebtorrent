import 'dotenv/config'
import { Router } from 'express'
import { randomBytes, webcrypto } from 'crypto'
import jwt from 'jsonwebtoken'
import { createUser, getUserByPubkey } from '../../db/repositories/userRepo.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()
const { subtle } = webcrypto
const JWT_SECRET  = process.env.JWT_SECRET  || 'dev-secret-change-me'
const JWT_EXPIRY  = process.env.JWT_EXPIRY  || '7d'
const NONCE_TTL_MS = 60_000

/** In-memory nonce store: nonce → expiresAt (ms). Never persisted. */
const pendingNonces = new Map()

// Evict expired nonces every 5 minutes to prevent unbounded growth under DoS
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    const now = Date.now()
    for (const [nonce, expiresAt] of pendingNonces) {
      if (expiresAt < now) pendingNonces.delete(nonce)
    }
  }, 5 * 60_000)
}

const ok   = (res, data, status = 200) =>
  res.status(status).json({ success: true, data, error: null })
const fail = (res, error, status) =>
  res.status(status).json({ success: false, data: null, error })

// GET /api/auth/challenge
router.get('/challenge', (req, res) => {
  const nonce = randomBytes(32).toString('hex')
  const expiresAt = Date.now() + NONCE_TTL_MS
  pendingNonces.set(nonce, expiresAt)
  ok(res, { nonce, expiresAt })
})

// POST /api/auth/login  { pubkey, nonce, signature }
router.post('/login', async (req, res, next) => {
  try {
    const { pubkey, nonce, signature } = req.body ?? {}

    if (!pubkey || typeof pubkey !== 'string' || pubkey.length !== 64) {
      return fail(res, 'Invalid pubkey', 400)
    }
    if (!nonce || typeof nonce !== 'string') {
      return fail(res, 'Nonce required', 400)
    }
    if (!signature || typeof signature !== 'string') {
      return fail(res, 'Signature required', 400)
    }

    // Consume nonce immediately — one-time use regardless of validity
    const expiresAt = pendingNonces.get(nonce)
    pendingNonces.delete(nonce)

    if (expiresAt === undefined || expiresAt < Date.now()) {
      return fail(res, 'Invalid or expired nonce', 401)
    }

    // Import the Ed25519 public key from raw bytes
    let cryptoKey
    try {
      const keyBytes = Buffer.from(pubkey, 'hex')
      cryptoKey = await subtle.importKey('raw', keyBytes, { name: 'Ed25519' }, false, ['verify'])
    } catch {
      return fail(res, 'Invalid pubkey', 400)
    }

    // Verify signature over nonce bytes (UTF-8 encoded)
    const sigBytes   = Buffer.from(signature, 'hex')
    const nonceBytes = Buffer.from(nonce, 'utf8')
    const valid = await subtle.verify('Ed25519', cryptoKey, sigBytes, nonceBytes)
    if (!valid) return fail(res, 'Invalid signature', 401)

    // Auto-register on first login
    let user = await getUserByPubkey(pubkey)
    if (!user) user = await createUser({ pubkey })

    const token = jwt.sign(
      { id: user.id, pubkey: user.pubkey, isAdmin: user.isAdmin },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: JWT_EXPIRY }
    )

    ok(res, { token, user: { id: user.id, isAdmin: user.isAdmin } })
  } catch (err) {
    next(err)
  }
})

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  ok(res, req.user)
})

export default router
