import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { webcrypto } from 'crypto'

const { subtle } = webcrypto

vi.mock('../../src/db/repositories/userRepo.js', () => ({
  createUser:      vi.fn(),
  getUserById:     vi.fn(),
  getUserByPubkey: vi.fn(),
  updateUser:      vi.fn(),
}))

vi.mock('../../src/db/db.js', async () => {
  const { MemoryLevel } = await import('memory-level')
  return { default: new MemoryLevel({ valueEncoding: 'utf8' }) }
})

vi.mock('../../src/torrent/client.js', () => ({
  addTorrent: vi.fn(), removeTorrent: vi.fn(),
  getTorrentStatus: vi.fn(), listTorrents: vi.fn(),
  client: { torrents: [] },
}))

vi.mock('../../src/torrent/seeder.js', () => ({
  reseedActiveTorrents: vi.fn().mockResolvedValue(undefined),
}))

import { createApp } from '../../src/api/server.js'
import { createUser, getUserByPubkey } from '../../src/db/repositories/userRepo.js'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'

let keyPair, pubkeyHex

beforeAll(async () => {
  keyPair = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const pubkeyBytes = await subtle.exportKey('raw', keyPair.publicKey)
  pubkeyHex = Buffer.from(pubkeyBytes).toString('hex')
})

async function signNonce(nonce) {
  const sigBytes = await subtle.sign('Ed25519', keyPair.privateKey, Buffer.from(nonce, 'utf8'))
  return Buffer.from(sigBytes).toString('hex')
}

const MOCK_USER = {
  id: 'abc123deadbeef',
  pubkey: null,
  isAdmin: false,
  gracePeriodEndsAt: null,
  createdAt: Date.now(),
}

let app
beforeEach(() => {
  vi.resetAllMocks()
  app = createApp()
  MOCK_USER.pubkey = pubkeyHex
})

// ---------------------------------------------------------------------------
// GET /api/auth/challenge
// ---------------------------------------------------------------------------
describe('GET /api/auth/challenge', () => {
  it('returns a 64-char hex nonce and a future expiresAt', async () => {
    const res = await request(app).get('/api/auth/challenge')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.nonce).toMatch(/^[0-9a-f]{64}$/)
    expect(res.body.data.expiresAt).toBeGreaterThan(Date.now())
  })

  it('each call produces a unique nonce', async () => {
    const r1 = await request(app).get('/api/auth/challenge')
    const r2 = await request(app).get('/api/auth/challenge')
    expect(r1.body.data.nonce).not.toBe(r2.body.data.nonce)
  })
})

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
describe('POST /api/auth/login', () => {
  it('200 with JWT — auto-creates user on first login (unknown pubkey)', async () => {
    getUserByPubkey.mockResolvedValue(null)
    createUser.mockResolvedValue(MOCK_USER)

    const challengeRes = await request(app).get('/api/auth/challenge')
    const { nonce } = challengeRes.body.data
    const signature = await signNonce(nonce)

    const res = await request(app)
      .post('/api/auth/login')
      .send({ pubkey: pubkeyHex, nonce, signature })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.token).toBeTruthy()
    expect(res.body.data.user).toMatchObject({ id: 'abc123deadbeef', isAdmin: false })
    expect(createUser).toHaveBeenCalledWith({ pubkey: pubkeyHex })
  })

  it('returns existing user on subsequent login (known pubkey)', async () => {
    getUserByPubkey.mockResolvedValue(MOCK_USER)

    const challengeRes = await request(app).get('/api/auth/challenge')
    const { nonce } = challengeRes.body.data
    const signature = await signNonce(nonce)

    const res = await request(app)
      .post('/api/auth/login')
      .send({ pubkey: pubkeyHex, nonce, signature })

    expect(res.status).toBe(200)
    expect(createUser).not.toHaveBeenCalled()
  })

  it('401 on expired nonce', async () => {
    const challengeRes = await request(app).get('/api/auth/challenge')
    const { nonce } = challengeRes.body.data
    const signature = await signNonce(nonce)

    // Advance time past TTL before the server checks expiry
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000)

    const res = await request(app)
      .post('/api/auth/login')
      .send({ pubkey: pubkeyHex, nonce, signature })

    expect(res.status).toBe(401)
    vi.restoreAllMocks()
  })

  it('401 on nonce reuse (one-time use)', async () => {
    getUserByPubkey.mockResolvedValue(MOCK_USER)

    const challengeRes = await request(app).get('/api/auth/challenge')
    const { nonce } = challengeRes.body.data
    const signature = await signNonce(nonce)

    await request(app).post('/api/auth/login').send({ pubkey: pubkeyHex, nonce, signature })
    const res = await request(app).post('/api/auth/login').send({ pubkey: pubkeyHex, nonce, signature })

    expect(res.status).toBe(401)
  })

  it('401 on invalid signature', async () => {
    const challengeRes = await request(app).get('/api/auth/challenge')
    const { nonce } = challengeRes.body.data
    const badSignature = Buffer.alloc(64, 0).toString('hex')

    const res = await request(app)
      .post('/api/auth/login')
      .send({ pubkey: pubkeyHex, nonce, signature: badSignature })

    expect(res.status).toBe(401)
  })

  it('400 when pubkey is missing', async () => {
    const challengeRes = await request(app).get('/api/auth/challenge')
    const { nonce } = challengeRes.body.data
    const signature = await signNonce(nonce)

    const res = await request(app).post('/api/auth/login').send({ nonce, signature })
    expect(res.status).toBe(400)
  })

  it('400 when nonce is missing', async () => {
    const signature = await signNonce('testnonce')
    const res = await request(app).post('/api/auth/login').send({ pubkey: pubkeyHex, signature })
    expect(res.status).toBe(400)
  })

  it('400 when signature is missing', async () => {
    const challengeRes = await request(app).get('/api/auth/challenge')
    const { nonce } = challengeRes.body.data

    const res = await request(app).post('/api/auth/login').send({ pubkey: pubkeyHex, nonce })
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
describe('GET /api/auth/me', () => {
  it('200 with user when token is valid', async () => {
    const token = jwt.sign(
      { id: 'abc123deadbeef', pubkey: 'a'.repeat(64), isAdmin: false },
      JWT_SECRET,
      { expiresIn: '1h' }
    )

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ id: 'abc123deadbeef', pubkey: 'a'.repeat(64) })
  })

  it('401 without token', async () => {
    const res = await request(app).get('/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('401 with malformed token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer notavalidtoken')
    expect(res.status).toBe(401)
  })
})
