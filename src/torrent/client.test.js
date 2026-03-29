import { describe, it, expect, afterAll } from 'vitest'
import { addTorrent, removeTorrent, getTorrentStatus, client } from './client.js'

// Public domain – Big Buck Bunny (Blender Foundation)
const BBB_MAGNET =
  'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337'

describe('WebTorrent client smoke test', () => {
  let infoHash

  afterAll(async () => {
    if (infoHash) await removeTorrent(infoHash)
    await new Promise((res) => client.destroy(res))
  })

  it('adds a torrent and resolves once metadata is ready', async () => {
    const torrent = await addTorrent(BBB_MAGNET)
    infoHash = torrent.infoHash

    expect(typeof infoHash).toBe('string')
    expect(infoHash).toHaveLength(40)
    expect(torrent.name).toBeTruthy()
  }, 60_000)

  it('getTorrentStatus returns all required fields', () => {
    const status = getTorrentStatus(infoHash)

    expect(status).not.toBeNull()
    expect(status).toMatchObject({
      infoHash: expect.any(String),
      name: expect.any(String),
      progress: expect.any(Number),
      downloadSpeed: expect.any(Number),
      uploadSpeed: expect.any(Number),
      numPeers: expect.any(Number),
      state: expect.stringMatching(/^(active|paused|done)$/),
    })
    expect(status.progress).toBeGreaterThanOrEqual(0)
    expect(status.progress).toBeLessThanOrEqual(1)
  })

  it('removeTorrent removes it so getTorrentStatus returns null', async () => {
    await removeTorrent(infoHash)
    expect(getTorrentStatus(infoHash)).toBeNull()
    infoHash = undefined
  })
})
