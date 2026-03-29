import 'dotenv/config'
import { resolve } from 'path'
import { rm } from 'fs/promises'
import { listAllTorrents, updateTorrent } from '../db/repositories/torrentRepo.js'
import { client } from '../torrent/client.js'

const DATA_DIR  = resolve(process.env.DATA_DIR ?? './data')
const FILES_DIR = resolve(DATA_DIR, 'files')

export async function runFileReaper() {
  const torrents = await listAllTorrents()
  const now = Date.now()

  for (const torrent of torrents) {
    if (!torrent.scheduledDeleteAt || torrent.state === 'deleted') continue
    if (torrent.scheduledDeleteAt > now) continue

    const { userId, infoHash } = torrent
    const live = client.torrents.find((t) => t.infoHash === infoHash)

    if (live) {
      await new Promise((res, rej) => {
        live.destroy({ destroyStore: true }, (err) => (err ? rej(err) : res()))
      })
    } else {
      const filePath = resolve(FILES_DIR, torrent.name ?? infoHash)
      await rm(filePath, { recursive: true, force: true })
    }

    await updateTorrent(userId, infoHash, { state: 'deleted', scheduledDeleteAt: null })
    console.log(`[reaper] deleted ${infoHash} for user ${userId}`)
  }
}

export function startFileReaper() {
  console.log('[fileReaper] starting')
  runFileReaper()
  return setInterval(runFileReaper, 60_000)
}
