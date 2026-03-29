import { listAllTorrents } from '../db/repositories/torrentRepo.js'
import { addTorrent } from './client.js'

/**
 * Re-add all torrents with state === 'active' to the WebTorrent client.
 * Called once at startup before the HTTP server begins listening.
 */
export async function reseedActiveTorrents() {
  const all = await listAllTorrents()
  const active = all.filter((t) => t.state === 'active')

  let reseeded = 0
  for (const t of active) {
    try {
      await addTorrent(t.magnetUri)
      reseeded++
    } catch (err) {
      console.error(`[seeder] failed to re-add ${t.infoHash}: ${err.message}`)
    }
  }

  console.log(`[seeder] re-added ${reseeded}/${active.length} active torrent(s)`)
}
