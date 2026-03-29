import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/api/server.js'

vi.mock('../../src/billing/deposits.js', () => ({
  createDepositAddress: vi.fn(),
}))

vi.mock('../../src/api/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 99, email: 'user@test.com', isAdmin: false }
    next()
  },
}))

// Prevent server.js startup side-effects in test
vi.mock('../../src/torrent/client.js', () => ({
  client: { torrents: [] },
  addTorrent: vi.fn(),
  removeTorrent: vi.fn(),
  getTorrentStatus: vi.fn(),
  listTorrents: vi.fn(),
}))

vi.mock('../../src/torrent/seeder.js', () => ({
  reseedActiveTorrents: vi.fn(),
}))

vi.mock('../../src/chain/poller.js', () => ({
  startPoller: vi.fn(),
  pollChain:   vi.fn(),
  processDeposit: vi.fn(),
}))

vi.mock('../../src/db/db.js', async () => {
  const { MemoryLevel } = await import('memory-level')
  return { default: new MemoryLevel({ valueEncoding: 'utf8' }) }
})

import { createDepositAddress } from '../../src/billing/deposits.js'

const app = createApp()

beforeEach(() => vi.resetAllMocks())

describe('POST /api/billing/deposit', () => {
  it('201 with address on valid ltc request', async () => {
    createDepositAddress.mockResolvedValue('Laddr123')

    const res = await request(app)
      .post('/api/billing/deposit')
      .send({ currency: 'ltc' })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data).toEqual({ currency: 'ltc', address: 'Laddr123' })
    expect(createDepositAddress).toHaveBeenCalledWith(99, 'ltc')
  })

  it('201 with address on valid xmr request', async () => {
    createDepositAddress.mockResolvedValue('4BXmrAddr')

    const res = await request(app)
      .post('/api/billing/deposit')
      .send({ currency: 'xmr' })

    expect(res.status).toBe(201)
    expect(res.body.data.currency).toBe('xmr')
    expect(res.body.data.address).toBe('4BXmrAddr')
  })

  it('400 for unsupported currency', async () => {
    const res = await request(app)
      .post('/api/billing/deposit')
      .send({ currency: 'btc' })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.error).toMatch(/Accepted/)
    expect(createDepositAddress).not.toHaveBeenCalled()
  })

  it('400 when currency is missing', async () => {
    const res = await request(app)
      .post('/api/billing/deposit')
      .send({})

    expect(res.status).toBe(400)
    expect(createDepositAddress).not.toHaveBeenCalled()
  })

  it('is case-insensitive for currency input', async () => {
    createDepositAddress.mockResolvedValue('Laddr999')

    const res = await request(app)
      .post('/api/billing/deposit')
      .send({ currency: 'LTC' })

    expect(res.status).toBe(201)
    expect(res.body.data.currency).toBe('ltc')
  })

  it('500 when createDepositAddress throws', async () => {
    createDepositAddress.mockRejectedValue(new Error('wallet error'))

    const res = await request(app)
      .post('/api/billing/deposit')
      .send({ currency: 'ltc' })

    expect(res.status).toBe(500)
    expect(res.body.error).toBe('wallet error')
  })
})
