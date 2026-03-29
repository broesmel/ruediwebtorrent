import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/api/server.js'

// --- mocks ---

let mockUser = { id: 1, email: 'admin@test.com', isAdmin: true }

vi.mock('../../src/api/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = mockUser
    next()
  },
}))

vi.mock('../../src/db/repositories/userRepo.js', () => ({
  listAllUsers:  vi.fn(),
  getUserById:   vi.fn(),
}))

vi.mock('../../src/db/repositories/torrentRepo.js', () => ({
  listAllTorrents:    vi.fn(),
  listTorrentsByUser: vi.fn(),
  getTorrent:         vi.fn(),
  createTorrent:      vi.fn(),
  deleteTorrent:      vi.fn(),
}))

vi.mock('../../src/db/repositories/balanceRepo.js', () => ({
  getBalance: vi.fn(),
}))

vi.mock('../../src/torrent/client.js', () => ({
  client:          { torrents: [] },
  addTorrent:      vi.fn(),
  removeTorrent:   vi.fn(),
  getTorrentStatus: vi.fn(),
  listTorrents:    vi.fn(),
}))

vi.mock('../../src/torrent/seeder.js', () => ({
  reseedActiveTorrents: vi.fn(),
}))

vi.mock('../../src/chain/poller.js', () => ({
  startPoller: vi.fn(),
}))

vi.mock('../../src/jobs/usageMeter.js', () => ({
  startUsageMeter: vi.fn(),
}))

vi.mock('../../src/jobs/balanceEnforcer.js', () => ({
  startBalanceEnforcer: vi.fn(),
}))

vi.mock('../../src/jobs/fileReaper.js', () => ({
  startFileReaper: vi.fn(),
}))

vi.mock('../../src/db/db.js', async () => {
  const { MemoryLevel } = await import('memory-level')
  return { default: new MemoryLevel({ valueEncoding: 'utf8' }) }
})

// --- imports ---

import { listAllUsers } from '../../src/db/repositories/userRepo.js'
import { listAllTorrents } from '../../src/db/repositories/torrentRepo.js'
import { getBalance } from '../../src/db/repositories/balanceRepo.js'

const app = createApp()

beforeEach(() => {
  vi.resetAllMocks()
  mockUser = { id: 1, email: 'admin@test.com', isAdmin: true }
})

describe('GET /api/admin/stats', () => {
  it('403 for non-admin users', async () => {
    mockUser = { id: 2, email: 'user@test.com', isAdmin: false }

    const res = await request(app).get('/api/admin/stats')

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('Forbidden')
  })

  it('200 with aggregated stats for admin', async () => {
    listAllUsers.mockResolvedValue([
      { id: 1 },
      { id: 2 },
    ])
    listAllTorrents.mockResolvedValue([
      { infoHash: 'aaa' },
      { infoHash: 'bbb' },
      { infoHash: 'ccc' },
    ])
    getBalance
      .mockResolvedValueOnce(10_000)
      .mockResolvedValueOnce(5_000)

    const res = await request(app).get('/api/admin/stats')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data).toEqual({
      userCount:               2,
      torrentCount:            3,
      totalBalanceMicroCredits: 15_000,
    })
  })

  it('returns zero counts for empty system', async () => {
    listAllUsers.mockResolvedValue([])
    listAllTorrents.mockResolvedValue([])

    const res = await request(app).get('/api/admin/stats')

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({
      userCount:               0,
      torrentCount:            0,
      totalBalanceMicroCredits: 0,
    })
  })
})
