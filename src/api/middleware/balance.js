import { getUserById } from '../../db/repositories/userRepo.js'

/**
 * Rejects with 402 if the user's grace period has expired.
 * Requires authenticate middleware to run first (sets req.user).
 *
 * Grace period timeline:
 *   balance <= 0  → gracePeriodEndsAt set by balanceEnforcer job
 *   gracePeriodEndsAt < now → 402, user must top up
 *   gracePeriodEndsAt not set, or in the future → allow
 */
export async function checkBalance(req, res, next) {
  try {
    const user = await getUserById(req.user.id)
    if (user?.gracePeriodEndsAt && user.gracePeriodEndsAt < Date.now()) {
      return res.status(402).json({
        success: false,
        data: null,
        error: 'Balance depleted — top up to resume uploads',
      })
    }
    next()
  } catch (err) {
    next(err)
  }
}
