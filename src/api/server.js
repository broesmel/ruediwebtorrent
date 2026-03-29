import 'dotenv/config'
import { fileURLToPath } from 'url'
import express from 'express'
import rateLimit from 'express-rate-limit'
import authRoutes    from './routes/auth.js'
import torrentRoutes from './routes/torrents.js'
import fileRoutes    from './routes/files.js'
import billingRoutes from './routes/billing.js'
import adminRoutes   from './routes/admin.js'
import { client } from '../torrent/client.js'
import db from '../db/db.js'
import { reseedActiveTorrents } from '../torrent/seeder.js'
import { startPoller } from '../chain/poller.js'
import { startUsageMeter } from '../jobs/usageMeter.js'
import { startBalanceEnforcer } from '../jobs/balanceEnforcer.js'
import { startFileReaper } from '../jobs/fileReaper.js'

const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
})

const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
})

export function createApp() {
  const app = express()

  app.use(express.json())

  // Rate limiting — skip in test environment to avoid flaky tests
  if (process.env.NODE_ENV !== 'test') {
    app.use(globalLimiter)
  }

  // Health
  app.get('/api/health', (req, res) => {
    res.json({
      success: true,
      data: {
        uptime: process.uptime(),
        torrentCount: client.torrents.length,
      },
      error: null,
    })
  })

  // Routes
  const applyAuthLimiter = process.env.NODE_ENV !== 'test' ? authLimiter : (_, __, next) => next()
  app.use('/api/auth',     applyAuthLimiter, authRoutes)
  app.use('/api/torrents', torrentRoutes)
  app.use('/api/files',    fileRoutes)
  app.use('/api/billing',  billingRoutes)
  app.use('/api/admin',    adminRoutes)

  // 404 for unknown routes
  app.use((req, res) => {
    res.status(404).json({ success: false, data: null, error: 'Not found' })
  })

  // Error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[server] unhandled error:', err.message)
    res.status(500).json({ success: false, data: null, error: err.message })
  })

  return app
}

// Start server when this module is the entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await db.open()
  await reseedActiveTorrents()
  startPoller()
  startUsageMeter()
  startBalanceEnforcer()
  startFileReaper()

  const app = createApp()
  const port = Number(process.env.PORT) || 3000
  app.listen(port, () => {
    console.log(`[server] listening on port ${port}`)
  })
}
