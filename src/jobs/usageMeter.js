import 'dotenv/config'
import db from '../db/db.js'
import { keys } from '../db/keys.js'
import { listAllTorrents } from '../db/repositories/torrentRepo.js'
import { getBalance } from '../db/repositories/balanceRepo.js'

const BALANCE_FLOOR = -50_000

async function getRateGbHour() {
  const raw = await db.get(keys.pricing('gb_hour'))
  return raw !== undefined ? Number(raw) : Number(process.env.RATE_GB_HOUR ?? 5)
}

export async function runUsageMeter() {
  const rateGbHour = await getRateGbHour()
  const torrents = await listAllTorrents()

  for (const torrent of torrents) {
    if (torrent.state !== 'active') continue

    const { userId, infoHash, sizeBytes } = torrent
    const balance = await getBalance(userId)
    if (balance <= 0) continue

    const gbHours = (sizeBytes / 1e9) * (60 / 3600)
    const cost = Math.ceil(gbHours * rateGbHour)
    if (cost <= 0) continue

    const newBalance = Math.max(balance - cost, BALANCE_FLOOR)
    const ts = Date.now()
    const ref = `meter:${infoHash}:${ts}`

    await db.batch([
      { type: 'put', key: keys.balance(userId), value: String(newBalance) },
      {
        type:  'put',
        key:   keys.transaction(userId, ts, ref),
        value: JSON.stringify({
          userId,
          type:        'debit',
          amount:      -cost,
          ref,
          description: `Usage: ${torrent.name ?? infoHash}`,
          createdAt:   ts,
        }),
      },
    ])
  }
}

export function startUsageMeter() {
  console.log('[usageMeter] starting')
  runUsageMeter()
  return setInterval(runUsageMeter, 60_000)
}
