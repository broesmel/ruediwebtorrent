import 'dotenv/config'
import { listAllUsers, updateUser } from '../db/repositories/userRepo.js'
import { listTorrentsByUser, updateTorrent } from '../db/repositories/torrentRepo.js'
import { getBalance } from '../db/repositories/balanceRepo.js'
import { client } from '../torrent/client.js'

const GRACE_PERIOD_MS = Number(process.env.GRACE_PERIOD_DAYS ?? 3) * 86_400_000
const DELETE_AFTER_MS = Number(process.env.DELETE_AFTER_DAYS ?? 7) * 86_400_000

export async function runBalanceEnforcer() {
  const users = await listAllUsers()
  const now = Date.now()

  for (const user of users) {
    const balance = await getBalance(user.id)
    const torrents = await listTorrentsByUser(user.id)

    // Step 3 — resume on top-up (checked first to avoid re-opening grace)
    if (balance > 0 && user.gracePeriodEndsAt !== null) {
      for (const t of torrents.filter((t) => t.state === 'paused')) {
        const live = client.torrents.find((lt) => lt.infoHash === t.infoHash)
        if (live) live.resume()
        await updateTorrent(user.id, t.infoHash, { state: 'active', scheduledDeleteAt: null })
      }
      await updateUser(user.id, { gracePeriodEndsAt: null })
      console.log(`[balanceEnforcer] user ${user.id} topped up — resumed`)
      continue
    }

    // Step 1 — open grace period
    if (balance <= 0 && user.gracePeriodEndsAt === null) {
      const gracePeriodEndsAt = now + GRACE_PERIOD_MS
      await updateUser(user.id, { gracePeriodEndsAt })
      console.log(
        `[balanceEnforcer] user ${user.id} — grace opened until ${new Date(gracePeriodEndsAt).toISOString()}`
      )
      continue
    }

    // Step 2 — pause after grace expires
    if (user.gracePeriodEndsAt !== null && user.gracePeriodEndsAt < now) {
      const scheduledDeleteAt = user.gracePeriodEndsAt + DELETE_AFTER_MS
      for (const t of torrents.filter((t) => t.state === 'active')) {
        const live = client.torrents.find((lt) => lt.infoHash === t.infoHash)
        if (live) live.pause()
        await updateTorrent(user.id, t.infoHash, { state: 'paused', scheduledDeleteAt })
      }
      console.log(`[balanceEnforcer] user ${user.id} — torrents paused, delete scheduled`)
    }
  }
}

export function startBalanceEnforcer() {
  console.log('[balanceEnforcer] starting')
  runBalanceEnforcer()
  return setInterval(runBalanceEnforcer, 60_000)
}
