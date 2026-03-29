import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'

vi.mock('../../src/torrent/client.js', () => ({
  addTorrent:       vi.fn(),
  removeTorrent:    vi.fn(),
  getTorrentStatus: vi.fn(),
  listTorrents:     vi.fn(),
  client: { torrents: [] },
}))

vi.mock('../../src/db/repositories/torrentRepo.js', () => ({
  createTorrent:      vi.fn(),
  getTorrent:         vi.fn(),
  getTorrentByHash:   vi.fn(),
  listTorrentsByUser: vi.fn(),
  listAllTorrents:    vi.fn(),
  updateTorrent:      vi.fn(),
  deleteTorrent:      vi.fn(),
}))

vi.mock('../../src/db/repositories/userRepo.js', () => ({
  createUser:     vi.fn(),
  getUserById:    vi.fn(),
  getUserByEmail: vi.fn(),
  updateUser:     vi.fn(),
  getNextUserId:  vi.fn(),
}))

vi.mock('../../src/db/db.js', async () => {
  const { MemoryLevel } = await import('memory-level')
  return { default: new MemoryLevel({ valueEncoding: 'utf8' }) }
})

vi.mock('../../src/torrent/seeder.js', () => ({
  reseedActiveTorrents: vi.fn().mockResolvedValue(undefined),
}))

import { createApp } from '../../src/api/server.js'
import {
  addTorrent, removeTorrent, getTorrentStatus, listTorrents, client,
} from '../../src/torrent/client.js'
import {
  createTorrent, getTorrent, listTorrentsByUser, deleteTorrent,
} from '../../src/db/repositories/torrentRepo.js'
import { getUserById } from '../../src/db/repositories/userRepo.js'

const JWT_SECRET  = process.env.JWT_SECRET || 'dev-secret-change-me'
const VALID_MAGNET = 'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Test'
const HASH         = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c'

const MOCK_STATUS = {
  infoHash: HASH, name: 'Test Torrent', progress: 0,
  downloadSpeed: 0, uploadSpeed: 0, numPeers: 0, state: 'active',
}

const MOCK_DB_TORRENT = {
  ...MOCK_STATUS, userId: 1, magnetUri: VALID_MAGNET,
  sizeBytes: 1000, addedAt: Date.now(), scheduledDeleteAt: null,
}

const MOCK_USER = { id: 1, email: 'u@test.com', isAdmin: false, gracePeriodEndsAt: null }

// Helper — generates a valid JWT for the mock user
function authHeader() {
  const token = jwt.sign(
    { id: 1, email: 'u@test.com', isAdmin: false },
    JWT_SECRET,
    { expiresIn: '1h' }
  )
  return `Bearer ${token}`
}

let app
beforeEach(() => {
  vi.resetAllMocks()
  app = createApp()
  // Default: user is within grace (no 402)
  getUserById.mockResolvedValue(MOCK_USER)
})

// ---------------------------------------------------------------------------
// POST /api/torrents
// ---------------------------------------------------------------------------
describe('POST /api/torrents', () => {
  it('201 with status on valid magnet', async () => {
    addTorrent.mockResolvedValue({ infoHash: HASH, length: 1000 })
    getTorrentStatus.mockReturnValue(MOCK_STATUS)
    createTorrent.mockResolvedValue(MOCK_DB_TORRENT)

    const res = await request(app)
      .post('/api/torrents')
      .set('Authorization', authHeader())
      .send({ magnet: VALID_MAGNET })

    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject(MOCK_STATUS)
    expect(createTorrent).toHaveBeenCalledWith(1, expect.objectContaining({ infoHash: HASH }))
  })

  it('401 without token', async () => {
    const res = await request(app).post('/api/torrents').send({ magnet: VALID_MAGNET })
    expect(res.status).toBe(401)
    expect(addTorrent).not.toHaveBeenCalled()
  })

  it('402 when grace period has expired', async () => {
    getUserById.mockResolvedValue({ ...MOCK_USER, gracePeriodEndsAt: Date.now() - 1000 })

    const res = await request(app)
      .post('/api/torrents')
      .set('Authorization', authHeader())
      .send({ magnet: VALID_MAGNET })

    expect(res.status).toBe(402)
    expect(addTorrent).not.toHaveBeenCalled()
  })

  it('400 on missing magnet', async () => {
    const res = await request(app)
      .post('/api/torrents')
      .set('Authorization', authHeader())
      .send({})
    expect(res.status).toBe(400)
  })

  it('400 on malformed magnet', async () => {
    const res = await request(app)
      .post('/api/torrents')
      .set('Authorization', authHeader())
      .send({ magnet: 'not-a-magnet' })
    expect(res.status).toBe(400)
  })

  it('500 when addTorrent rejects', async () => {
    addTorrent.mockRejectedValue(new Error('network error'))

    const res = await request(app)
      .post('/api/torrents')
      .set('Authorization', authHeader())
      .send({ magnet: VALID_MAGNET })

    expect(res.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// GET /api/torrents
// ---------------------------------------------------------------------------
describe('GET /api/torrents', () => {
  it('200 with merged DB + live stats', async () => {
    listTorrentsByUser.mockResolvedValue([MOCK_DB_TORRENT])
    getTorrentStatus.mockReturnValue(MOCK_STATUS)

    const res = await request(app)
      .get('/api/torrents')
      .set('Authorization', authHeader())

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(listTorrentsByUser).toHaveBeenCalledWith(1)
  })

  it('401 without token', async () => {
    const res = await request(app).get('/api/torrents')
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// GET /api/torrents/:hash
// ---------------------------------------------------------------------------
describe('GET /api/torrents/:hash', () => {
  it('200 with torrent when found', async () => {
    getTorrent.mockResolvedValue(MOCK_DB_TORRENT)
    getTorrentStatus.mockReturnValue(MOCK_STATUS)

    const res = await request(app)
      .get(`/api/torrents/${HASH}`)
      .set('Authorization', authHeader())

    expect(res.status).toBe(200)
    expect(getTorrent).toHaveBeenCalledWith(1, HASH)
  })

  it('404 when torrent not found', async () => {
    getTorrent.mockResolvedValue(null)

    const res = await request(app)
      .get('/api/torrents/deadbeef')
      .set('Authorization', authHeader())

    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/torrents/:hash
// ---------------------------------------------------------------------------
describe('DELETE /api/torrents/:hash', () => {
  it('200 and removes from client + DB', async () => {
    removeTorrent.mockResolvedValue()
    deleteTorrent.mockResolvedValue()

    const res = await request(app)
      .delete(`/api/torrents/${HASH}`)
      .set('Authorization', authHeader())

    expect(res.status).toBe(200)
    expect(removeTorrent).toHaveBeenCalledWith(HASH, { destroyStore: false })
    expect(deleteTorrent).toHaveBeenCalledWith(1, HASH)
  })

  it('passes destroyStore=true when ?destroyFiles=true', async () => {
    removeTorrent.mockResolvedValue()
    deleteTorrent.mockResolvedValue()

    await request(app)
      .delete(`/api/torrents/${HASH}?destroyFiles=true`)
      .set('Authorization', authHeader())

    expect(removeTorrent).toHaveBeenCalledWith(HASH, { destroyStore: true })
  })
})

// ---------------------------------------------------------------------------
// GET /api/health
// ---------------------------------------------------------------------------
describe('GET /api/health', () => {
  it('200 with uptime and torrentCount', async () => {
    client.torrents = [{}, {}]
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.data.torrentCount).toBe(2)
  })
})
