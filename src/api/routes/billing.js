import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { authenticate } from '../middleware/auth.js'
import { createDepositAddress } from '../../billing/deposits.js'

const depositLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  keyGenerator: (req) => String(req.user.id),
  standardHeaders: true,
  legacyHeaders: false,
})

const router = Router()

const applyDepositLimiter = process.env.NODE_ENV !== 'test'
  ? depositLimiter
  : (_, __, next) => next()

// POST /api/billing/deposit
router.post('/deposit', authenticate, applyDepositLimiter, async (req, res) => {
  const { currency } = req.body

  const accepted = (process.env.ACCEPTED_CURRENCIES ?? 'ltc,xmr')
    .split(',')
    .map((s) => s.trim().toLowerCase())

  if (!currency || !accepted.includes(currency.toLowerCase())) {
    return res.status(400).json({
      success: false,
      data:    null,
      error:   `Unsupported currency. Accepted: ${accepted.join(', ')}`,
    })
  }

  try {
    const address = await createDepositAddress(req.user.id, currency)
    return res.status(201).json({
      success: true,
      data:    { currency: currency.toLowerCase(), address },
      error:   null,
    })
  } catch (err) {
    return res.status(500).json({ success: false, data: null, error: err.message })
  }
})

export default router
