import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import http from 'http'
import request from 'supertest'
import { createApp } from '../../src/api/server.js'

// --- mocks ---

vi.mock('../../src/api/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 42, email: 'u@test.com', isAdmin: false }
    next()
  },
}))

vi.mock('../../src/db/repositories/torrentRepo.js', () => ({
  getTorrent:         vi.fn(),
  listTorrentsByUser: vi.fn(),
  createTorrent:      vi.fn(),
  deleteTorrent:      vi.fn(),
}))

vi.mock('../../src/db/repositories/balanceRepo.js', () => ({
  getBalance: vi.fn(),
}))

vi.mock('../../src/db/repositories/userRepo.js', () => ({
  getUserById:  vi.fn(),
  listAllUsers: vi.fn(),
}))

vi.mock('../../src/torrent/client.js', () => ({
  client:           { torrents: [] },
  addTorrent:       vi.fn(),
  removeTorrent:    vi.fn(),
  getTorrentStatus: vi.fn(),
  listTorrents:     vi.fn(),
}))

vi.mock('../../src/torrent/seeder.js', () => ({ reseedActiveTorrents: vi.fn() }))
vi.mock('../../src/chain/poller.js',   () => ({ startPoller: vi.fn() }))
vi.mock('../../src/jobs/usageMeter.js',     () => ({ startUsageMeter: vi.fn() }))
vi.mock('../../src/jobs/balanceEnforcer.js',() => ({ startBalanceEnforcer: vi.fn() }))
vi.mock('../../src/jobs/fileReaper.js',     () => ({ startFileReaper: vi.fn() }))

vi.mock('../../src/db/db.js', async () => {
  const { MemoryLevel } = await import('memory-level')
  return { default: new MemoryLevel({ valueEncoding: 'utf8' }) }
})

// --- imports ---

import { getTorrent } from '../../src/db/repositories/torrentRepo.js'
import { getBalance } from '../../src/db/repositories/balanceRepo.js'
import { getUserById } from '../../src/db/repositories/userRepo.js'
import { getTorrentStatus } from '../../src/torrent/client.js'

const app = createApp()

const dbTorrent = {
  infoHash: 'abc123', name: 'TestFile', sizeBytes: 1_000_000,
  state: 'active', userId: 42, scheduledDeleteAt: null,
}
const mockUser = { id: 42, email: 'u@test.com', gracePeriodEndsAt: null }

beforeEach(() => vi.resetAllMocks())
afterEach(() => vi.useRealTimers())

describe('GET /api/torrents/:hash/progress', () => {
  it('404 when torrent not found', async () => {
    getTorrent.mockResolvedValue(null)

    const res = await request(app).get('/api/torrents/missing/progress')

    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })

  it('streams SSE headers and first data event', async () => {
    // Freeze timers so the 2s/15s intervals never fire after the initial send
    vi.useFakeTimers()

    getTorrent.mockResolvedValue(dbTorrent)
    getBalance.mockResolvedValue(12_500)
    getUserById.mockResolvedValue(mockUser)
    getTorrentStatus.mockReturnValue({ progress: 0.42, uploadSpeed: 51_200, numPeers: 4 })

    const server = http.createServer(app)

    const payload = await new Promise((resolve, reject) => {
      server.listen(0, () => {
        const { port } = server.address()

        const req = http.get(
          { hostname: '127.0.0.1', port, path: '/api/torrents/abc123/progress' },
          (res) => {
            expect(res.headers['content-type']).toMatch(/text\/event-stream/)
            expect(res.headers['cache-control']).toBe('no-cache')

            let buf = ''
            res.on('data', (chunk) => {
              buf += chunk.toString()
              const line = buf.split('\n').find((l) => l.startsWith('data:'))
              if (!line) return
              req.destroy()
              server.close(() => resolve(JSON.parse(line.slice(5).trim())))
            })
          }
        )
        req.on('error', (err) => {
          if (err.code !== 'ECONNRESET') server.close(() => reject(err))
        })
      })
    })

    expect(payload.progress).toBeCloseTo(0.42)
    expect(payload.uploadSpeed).toBe(51_200)
    expect(payload.numPeers).toBe(4)
    expect(payload.balanceMicroCredits).toBe(12_500)
    expect(payload.gracePeriodEndsAt).toBeNull()
    expect(payload.scheduledDeleteAt).toBeNull()
  })

  it('falls back to zeroes when torrent is not live in client', async () => {
    vi.useFakeTimers()

    getTorrent.mockResolvedValue(dbTorrent)
    getBalance.mockResolvedValue(0)
    getUserById.mockResolvedValue(mockUser)
    getTorrentStatus.mockReturnValue(null) // not in WebTorrent client

    const server = http.createServer(app)

    const payload = await new Promise((resolve, reject) => {
      server.listen(0, () => {
        const { port } = server.address()
        const req = http.get(
          { hostname: '127.0.0.1', port, path: '/api/torrents/abc123/progress' },
          (res) => {
            let buf = ''
            res.on('data', (chunk) => {
              buf += chunk.toString()
              const line = buf.split('\n').find((l) => l.startsWith('data:'))
              if (!line) return
              req.destroy()
              server.close(() => resolve(JSON.parse(line.slice(5).trim())))
            })
          }
        )
        req.on('error', (err) => {
          if (err.code !== 'ECONNRESET') server.close(() => reject(err))
        })
      })
    })

    expect(payload.progress).toBe(0)
    expect(payload.uploadSpeed).toBe(0)
    expect(payload.numPeers).toBe(0)
  })
})
