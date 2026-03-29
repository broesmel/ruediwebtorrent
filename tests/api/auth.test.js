import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'

vi.mock('../../src/db/repositories/userRepo.js', () => ({
  createUser:      vi.fn(),
  getUserById:     vi.fn(),
  getUserByEmail:  vi.fn(),
  updateUser:      vi.fn(),
  getNextUserId:   vi.fn(),
}))

vi.mock('bcrypt', () => ({
  default: {
    hash:    vi.fn().mockResolvedValue('$2b$12$hashedpassword'),
    compare: vi.fn(),
  },
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
import { createUser, getUserByEmail, getUserById } from '../../src/db/repositories/userRepo.js'
import bcrypt from 'bcrypt'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'

const MOCK_USER = {
  id: 1, email: 'test@test.com', passwordHash: '$2b$12$hashedpassword',
  isAdmin: false, gracePeriodEndsAt: null, createdAt: Date.now(),
}

let app
beforeEach(() => {
  vi.resetAllMocks()
  app = createApp()
})

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------
describe('POST /api/auth/register', () => {
  it('201 with token and user on valid credentials', async () => {
    getUserByEmail.mockResolvedValue(null)
    createUser.mockResolvedValue(MOCK_USER)

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@test.com', password: 'password123' })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.token).toBeTruthy()
    expect(res.body.data.user).toMatchObject({ id: 1, email: 'test@test.com', isAdmin: false })
    expect(res.body.data.user.passwordHash).toBeUndefined()
    expect(bcrypt.hash).toHaveBeenCalledWith('password123', 12)
  })

  it('409 when email already registered', async () => {
    getUserByEmail.mockResolvedValue(MOCK_USER)

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@test.com', password: 'password123' })

    expect(res.status).toBe(409)
    expect(createUser).not.toHaveBeenCalled()
  })

  it('400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ password: 'password123' })
    expect(res.status).toBe(400)
  })

  it('400 when password is too short', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@test.com', password: 'short' })
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
describe('POST /api/auth/login', () => {
  it('200 with token on valid credentials', async () => {
    getUserByEmail.mockResolvedValue(MOCK_USER)
    bcrypt.compare.mockResolvedValue(true)

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@test.com', password: 'password123' })

    expect(res.status).toBe(200)
    expect(res.body.data.token).toBeTruthy()
    expect(res.body.data.user.email).toBe('test@test.com')
  })

  it('401 on wrong password', async () => {
    getUserByEmail.mockResolvedValue(MOCK_USER)
    bcrypt.compare.mockResolvedValue(false)

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@test.com', password: 'wrongpassword' })

    expect(res.status).toBe(401)
  })

  it('401 on unknown email', async () => {
    getUserByEmail.mockResolvedValue(null)

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.com', password: 'password123' })

    expect(res.status).toBe(401)
  })

  it('400 when fields are missing', async () => {
    const res = await request(app).post('/api/auth/login').send({})
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
describe('GET /api/auth/me', () => {
  it('200 with user when token is valid', async () => {
    const token = jwt.sign(
      { id: 1, email: 'test@test.com', isAdmin: false },
      JWT_SECRET,
      { expiresIn: '1h' }
    )

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ id: 1, email: 'test@test.com' })
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
