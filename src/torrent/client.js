import 'dotenv/config'
import { resolve } from 'path'
import WebTorrent from 'webtorrent'

const DATA_DIR = resolve(process.env.DATA_DIR ?? './data')

const client = new WebTorrent()

client.on('error', (err) => {
  console.error('[webtorrent] client error:', err.message)
})

/**
 * Add a torrent by magnet URI or info hash.
 * Resolves with the torrent object once metadata is ready.
 * On duplicate, resolves with the already-active torrent.
 * @param {string} magnetOrHash
 * @returns {Promise<import('webtorrent').Torrent>}
 */
export function addTorrent(magnetOrHash) {
  return new Promise((resolve, reject) => {
    // The third argument (ontorrent) fires when the torrent has metadata.
    // On duplicate infoHash, WebTorrent destroys the new one and calls
    // ontorrent with the existing torrent — so resolve is still called correctly.
    const torrent = client.add(magnetOrHash, { path: DATA_DIR }, (readyTorrent) => {
      resolve(readyTorrent)
    })
    // Catch errors before metadata (invalid magnet, network failure, etc.)
    torrent.once('error', reject)
  })
}

/**
 * Remove a torrent from the client.
 * No-ops if the torrent is not found.
 * @param {string} infoHash
 * @param {{ destroyStore?: boolean }} [opts]
 * @returns {Promise<void>}
 */
export function removeTorrent(infoHash, { destroyStore = false } = {}) {
  return new Promise((resolve, reject) => {
    // client.torrents is a synchronous array — no need for async client.get()
    const torrent = client.torrents.find((t) => t.infoHash === infoHash)
    if (!torrent) return resolve()
    torrent.destroy({ destroyStore }, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

/**
 * List all torrents that have resolved metadata.
 * @returns {Array<ReturnType<typeof getTorrentStatus>>}
 */
export function listTorrents() {
  return client.torrents
    .filter((t) => t.infoHash)
    .map((t) => getTorrentStatus(t.infoHash))
    .filter(Boolean)
}

/**
 * Get the current status of a torrent.
 * Returns null if the torrent is not in the client.
 * @param {string} infoHash
 * @returns {{ infoHash: string, name: string, progress: number, downloadSpeed: number, uploadSpeed: number, numPeers: number, state: 'active'|'paused'|'done' } | null}
 */
export function getTorrentStatus(infoHash) {
  const torrent = client.torrents.find((t) => t.infoHash === infoHash)
  if (!torrent) return null

  let state = 'active'
  if (torrent.done) state = 'done'
  else if (torrent.paused) state = 'paused'

  return {
    infoHash: torrent.infoHash,
    name: torrent.name,
    progress: torrent.progress,
    downloadSpeed: torrent.downloadSpeed,
    uploadSpeed: torrent.uploadSpeed,
    numPeers: torrent.numPeers,
    state,
  }
}

export { client }
