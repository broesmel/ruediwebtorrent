import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../../src/db/db.js', async () => {
  const { MemoryLevel } = await import('memory-level')
  return { default: new MemoryLevel({ valueEncoding: 'utf8' }) }
})

import db from '../../src/db/db.js'
import {
  createTorrent,
  getTorrent,
  getTorrentByHash,
  listTorrentsByUser,
  listAllTorrents,
  updateTorrent,
  deleteTorrent,
} from '../../src/db/repositories/torrentRepo.js'

const HASH = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c'
const TORRENT_DATA = {
  infoHash: HASH,
  name: 'Big Buck Bunny',
  magnetUri: `magnet:?xt=urn:btih:${HASH}`,
  sizeBytes: 1_000_000,
}

beforeEach(async () => {
  await db.clear()
})

describe('createTorrent', () => {
  it('returns torrent with defaults', async () => {
    const t = await createTorrent(1, TORRENT_DATA)
    expect(t).toMatchObject({ ...TORRENT_DATA, userId: 1, state: 'active' })
    expect(t.addedAt).toBeTypeOf('number')
    expect(t.scheduledDeleteAt).toBeNull()
  })

  it('accepts explicit state', async () => {
    const t = await createTorrent(1, { ...TORRENT_DATA, state: 'paused' })
    expect(t.state).toBe('paused')
  })
})

describe('getTorrent', () => {
  it('retrieves by userId + infoHash', async () => {
    await createTorrent(1, TORRENT_DATA)
    const t = await getTorrent(1, HASH)
    expect(t.infoHash).toBe(HASH)
  })

  it('returns null for missing torrent', async () => {
    expect(await getTorrent(1, 'deadbeef')).toBeNull()
  })

  it('returns null for wrong userId', async () => {
    await createTorrent(1, TORRENT_DATA)
    expect(await getTorrent(2, HASH)).toBeNull()
  })
})

describe('getTorrentByHash', () => {
  it('resolves via reverse index', async () => {
    await createTorrent(1, TORRENT_DATA)
    const t = await getTorrentByHash(HASH)
    expect(t).not.toBeNull()
    expect(t.userId).toBe(1)
  })

  it('returns null for unknown hash', async () => {
    expect(await getTorrentByHash('unknown')).toBeNull()
  })
})

describe('listTorrentsByUser', () => {
  it('returns only that user\'s torrents', async () => {
    const hash2 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    await createTorrent(1, TORRENT_DATA)
    await createTorrent(1, { ...TORRENT_DATA, infoHash: hash2, name: 'Other' })
    await createTorrent(2, TORRENT_DATA) // different user, same hash

    const user1 = await listTorrentsByUser(1)
    expect(user1).toHaveLength(2)
    expect(user1.every((t) => t.userId === 1)).toBe(true)
  })

  it('returns empty array when user has no torrents', async () => {
    expect(await listTorrentsByUser(99)).toEqual([])
  })
})

describe('listAllTorrents', () => {
  it('returns torrents across all users', async () => {
    const hash2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    await createTorrent(1, TORRENT_DATA)
    await createTorrent(2, { ...TORRENT_DATA, infoHash: hash2, name: 'Other' })
    const all = await listAllTorrents()
    expect(all.length).toBeGreaterThanOrEqual(2)
  })
})

describe('updateTorrent', () => {
  it('merges fields onto existing record', async () => {
    await createTorrent(1, TORRENT_DATA)
    const updated = await updateTorrent(1, HASH, { state: 'paused', scheduledDeleteAt: 9999 })
    expect(updated.state).toBe('paused')
    expect(updated.scheduledDeleteAt).toBe(9999)
    expect(updated.name).toBe('Big Buck Bunny') // unchanged
  })

  it('throws for unknown torrent', async () => {
    await expect(updateTorrent(1, 'notexist', {})).rejects.toThrow()
  })
})

describe('deleteTorrent', () => {
  it('removes primary and reverse-index keys', async () => {
    await createTorrent(1, TORRENT_DATA)
    await deleteTorrent(1, HASH)
    expect(await getTorrent(1, HASH)).toBeNull()
    expect(await getTorrentByHash(HASH)).toBeNull()
  })
})
