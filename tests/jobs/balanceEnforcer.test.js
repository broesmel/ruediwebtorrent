import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db/repositories/userRepo.js', () => ({
  listAllUsers:  vi.fn(),
  updateUser:    vi.fn(),
}))

vi.mock('../../src/db/repositories/torrentRepo.js', () => ({
  listTorrentsByUser: vi.fn(),
  updateTorrent:      vi.fn(),
}))

vi.mock('../../src/db/repositories/balanceRepo.js', () => ({
  getBalance: vi.fn(),
}))

vi.mock('../../src/torrent/client.js', () => ({
  client: { torrents: [] },
}))

import { runBalanceEnforcer } from '../../src/jobs/balanceEnforcer.js'
import { listAllUsers, updateUser }  from '../../src/db/repositories/userRepo.js'
import { listTorrentsByUser, updateTorrent } from '../../src/db/repositories/torrentRepo.js'
import { getBalance } from '../../src/db/repositories/balanceRepo.js'
import { client } from '../../src/torrent/client.js'

const user = (overrides = {}) => ({
  id:                1,
  gracePeriodEndsAt: null,
  ...overrides,
})

const torrentRecord = (overrides = {}) => ({
  infoHash: 'abc123',
  state:    'active',
  ...overrides,
})

beforeEach(() => {
  vi.resetAllMocks()
  client.torrents.length = 0
  updateUser.mockResolvedValue({})
  updateTorrent.mockResolvedValue({})
})

describe('runBalanceEnforcer', () => {
  describe('step 1 — open grace period', () => {
    it('sets gracePeriodEndsAt when balance hits 0', async () => {
      listAllUsers.mockResolvedValue([user()])
      getBalance.mockResolvedValue(0)
      listTorrentsByUser.mockResolvedValue([])

      await runBalanceEnforcer()

      expect(updateUser).toHaveBeenCalledWith(1, expect.objectContaining({
        gracePeriodEndsAt: expect.any(Number),
      }))
    })

    it('does not open grace period if balance is positive', async () => {
      listAllUsers.mockResolvedValue([user()])
      getBalance.mockResolvedValue(100)
      listTorrentsByUser.mockResolvedValue([])

      await runBalanceEnforcer()

      expect(updateUser).not.toHaveBeenCalled()
    })
  })

  describe('step 2 — pause after grace expires', () => {
    it('pauses active torrents and sets scheduledDeleteAt', async () => {
      const expired = Date.now() - 1000
      listAllUsers.mockResolvedValue([user({ gracePeriodEndsAt: expired })])
      getBalance.mockResolvedValue(0)
      listTorrentsByUser.mockResolvedValue([torrentRecord()])

      const mockLiveTorrent = { infoHash: 'abc123', pause: vi.fn(), resume: vi.fn() }
      client.torrents.push(mockLiveTorrent)

      await runBalanceEnforcer()

      expect(mockLiveTorrent.pause).toHaveBeenCalled()
      expect(updateTorrent).toHaveBeenCalledWith(1, 'abc123', expect.objectContaining({
        state:             'paused',
        scheduledDeleteAt: expect.any(Number),
      }))
    })

    it('does not pause if grace period has not expired yet', async () => {
      const future = Date.now() + 100_000
      listAllUsers.mockResolvedValue([user({ gracePeriodEndsAt: future })])
      getBalance.mockResolvedValue(0)
      listTorrentsByUser.mockResolvedValue([torrentRecord()])

      await runBalanceEnforcer()

      expect(updateTorrent).not.toHaveBeenCalled()
    })
  })

  describe('step 3 — resume on top-up', () => {
    it('resumes paused torrents and clears grace period', async () => {
      const grace = Date.now() + 100_000
      listAllUsers.mockResolvedValue([user({ gracePeriodEndsAt: grace })])
      getBalance.mockResolvedValue(5_000)
      listTorrentsByUser.mockResolvedValue([torrentRecord({ state: 'paused' })])

      const mockLiveTorrent = { infoHash: 'abc123', pause: vi.fn(), resume: vi.fn() }
      client.torrents.push(mockLiveTorrent)

      await runBalanceEnforcer()

      expect(mockLiveTorrent.resume).toHaveBeenCalled()
      expect(updateTorrent).toHaveBeenCalledWith(1, 'abc123', {
        state:             'active',
        scheduledDeleteAt: null,
      })
      expect(updateUser).toHaveBeenCalledWith(1, { gracePeriodEndsAt: null })
    })

    it('handles missing live torrent gracefully on resume', async () => {
      const grace = Date.now() + 100_000
      listAllUsers.mockResolvedValue([user({ gracePeriodEndsAt: grace })])
      getBalance.mockResolvedValue(5_000)
      listTorrentsByUser.mockResolvedValue([torrentRecord({ state: 'paused' })])
      // client.torrents is empty — no live torrent

      await expect(runBalanceEnforcer()).resolves.toBeUndefined()
      expect(updateTorrent).toHaveBeenCalled()
    })
  })
})
