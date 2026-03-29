import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db/repositories/torrentRepo.js', () => ({
  listAllTorrents: vi.fn(),
  updateTorrent:   vi.fn(),
}))

vi.mock('../../src/torrent/client.js', () => ({
  client: { torrents: [] },
}))

vi.mock('fs/promises', () => ({
  rm: vi.fn(),
}))

import { runFileReaper } from '../../src/jobs/fileReaper.js'
import { listAllTorrents, updateTorrent } from '../../src/db/repositories/torrentRepo.js'
import { client } from '../../src/torrent/client.js'
import { rm } from 'fs/promises'

const torrent = (overrides = {}) => ({
  userId:            1,
  infoHash:          'abc123',
  name:              'MyFile',
  state:             'paused',
  scheduledDeleteAt: Date.now() - 1000, // already due
  ...overrides,
})

beforeEach(() => {
  vi.resetAllMocks()
  client.torrents.length = 0
  updateTorrent.mockResolvedValue({})
  rm.mockResolvedValue()
})

describe('runFileReaper', () => {
  it('skips torrents with no scheduledDeleteAt', async () => {
    listAllTorrents.mockResolvedValue([torrent({ scheduledDeleteAt: null })])

    await runFileReaper()

    expect(updateTorrent).not.toHaveBeenCalled()
    expect(rm).not.toHaveBeenCalled()
  })

  it('skips torrents already marked deleted', async () => {
    listAllTorrents.mockResolvedValue([torrent({ state: 'deleted' })])

    await runFileReaper()

    expect(updateTorrent).not.toHaveBeenCalled()
  })

  it('skips torrents whose deadline has not passed', async () => {
    listAllTorrents.mockResolvedValue([torrent({ scheduledDeleteAt: Date.now() + 100_000 })])

    await runFileReaper()

    expect(updateTorrent).not.toHaveBeenCalled()
  })

  it('destroys via client when torrent is in WebTorrent', async () => {
    const mockDestroy = vi.fn((opts, cb) => cb(null))
    const liveTorrent = { infoHash: 'abc123', destroy: mockDestroy }
    client.torrents.push(liveTorrent)

    listAllTorrents.mockResolvedValue([torrent()])

    await runFileReaper()

    expect(mockDestroy).toHaveBeenCalledWith({ destroyStore: true }, expect.any(Function))
    expect(rm).not.toHaveBeenCalled()
    expect(updateTorrent).toHaveBeenCalledWith(1, 'abc123', {
      state:             'deleted',
      scheduledDeleteAt: null,
    })
  })

  it('falls back to fs.rm when torrent is not in client', async () => {
    listAllTorrents.mockResolvedValue([torrent()])
    // client.torrents is empty

    await runFileReaper()

    expect(rm).toHaveBeenCalledWith(expect.stringContaining('MyFile'), {
      recursive: true,
      force:     true,
    })
    expect(updateTorrent).toHaveBeenCalledWith(1, 'abc123', {
      state:             'deleted',
      scheduledDeleteAt: null,
    })
  })

  it('processes multiple due torrents in one run', async () => {
    listAllTorrents.mockResolvedValue([
      torrent({ infoHash: 't1', name: 'File1' }),
      torrent({ infoHash: 't2', name: 'File2' }),
    ])

    await runFileReaper()

    expect(rm).toHaveBeenCalledTimes(2)
    expect(updateTorrent).toHaveBeenCalledTimes(2)
  })
})
