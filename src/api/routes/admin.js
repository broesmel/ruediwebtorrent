import { Router } from 'express'
import { authenticate } from '../middleware/auth.js'
import { requireAdmin } from '../middleware/admin.js'
import { listAllUsers } from '../../db/repositories/userRepo.js'
import { listAllTorrents } from '../../db/repositories/torrentRepo.js'
import { getBalance } from '../../db/repositories/balanceRepo.js'

const router = Router()

// GET /api/admin/stats
router.get('/stats', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const [users, torrents] = await Promise.all([listAllUsers(), listAllTorrents()])

    let totalBalanceMicroCredits = 0
    for (const user of users) {
      totalBalanceMicroCredits += await getBalance(user.id)
    }

    res.json({
      success: true,
      data: {
        userCount:               users.length,
        torrentCount:            torrents.length,
        totalBalanceMicroCredits,
      },
      error: null,
    })
  } catch (err) {
    next(err)
  }
})

export default router
