import db from '../db.js'
import { keys } from '../keys.js'

/**
 * Create a torrent record. Writes two keys atomically:
 *   torrents:{userId}:{infoHash}  → torrent object
 *   torrents:hash:{infoHash}      → userId  (reverse index)
 */
export async function createTorrent(userId, { infoHash, name, magnetUri, sizeBytes, state = 'active' }) {
  const torrent = {
    infoHash,
    name,
    magnetUri,
    sizeBytes,
    state,
    userId,
    addedAt: Date.now(),
    scheduledDeleteAt: null,
  }
  await db.batch([
    { type: 'put', key: keys.torrent(userId, infoHash),  value: JSON.stringify(torrent) },
    { type: 'put', key: keys.torrentByHash(infoHash),    value: String(userId) },
  ])
  return torrent
}

export async function getTorrent(userId, infoHash) {
  const raw = await db.get(keys.torrent(userId, infoHash))
  return raw !== undefined ? JSON.parse(raw) : null
}

/** Reverse-index lookup — resolves to the full torrent object via userId. */
export async function getTorrentByHash(infoHash) {
  const userIdRaw = await db.get(keys.torrentByHash(infoHash))
  if (userIdRaw === undefined) return null
  return getTorrent(Number(userIdRaw), infoHash)
}

/** Prefix scan — returns all torrent records for a given user. */
export async function listTorrentsByUser(userId) {
  const torrents = []
  for await (const [, value] of db.iterator({
    gte: keys.torrentsPrefix(userId),
    lte: keys.torrentsPrefix(userId) + '~',
  })) {
    torrents.push(JSON.parse(value))
  }
  return torrents
}

/** Prefix scan across all users — used by billing jobs. */
export async function listAllTorrents() {
  const torrents = []
  for await (const [, value] of db.iterator({
    gte: 'torrents:',
    lte: 'torrents:~',
  })) {
    const parsed = JSON.parse(value)
    // Skip the reverse-index keys (their values are plain userId strings, not objects)
    if (parsed && typeof parsed === 'object') torrents.push(parsed)
  }
  return torrents
}

export async function updateTorrent(userId, infoHash, updates) {
  const torrent = await getTorrent(userId, infoHash)
  if (!torrent) throw new Error(`Torrent ${infoHash} not found for user ${userId}`)
  const updated = { ...torrent, ...updates }
  await db.put(keys.torrent(userId, infoHash), JSON.stringify(updated))
  return updated
}

/** Remove both the primary record and the reverse index atomically. */
export async function deleteTorrent(userId, infoHash) {
  await db.batch([
    { type: 'del', key: keys.torrent(userId, infoHash) },
    { type: 'del', key: keys.torrentByHash(infoHash) },
  ])
}
