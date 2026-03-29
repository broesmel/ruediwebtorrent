import { Router } from 'express'
import {
  addTorrent,
  removeTorrent,
  getTorrentStatus,
  listTorrents,
  client,
} from '../../torrent/client.js'
import {
  createTorrent,
  getTorrent,
  listTorrentsByUser,
  deleteTorrent,
} from '../../db/repositories/torrentRepo.js'
import { getBalance } from '../../db/repositories/balanceRepo.js'
import { getUserById } from '../../db/repositories/userRepo.js'
import { authenticate } from '../middleware/auth.js'
import { checkBalance } from '../middleware/balance.js'
import { validateMagnet } from '../middleware/validateMagnet.js'

const router = Router()

const ok   = (res, data, status = 200) =>
  res.status(status).json({ success: true, data, error: null })
const fail = (res, error, status) =>
  res.status(status).json({ success: false, data: null, error })

/** Merge DB record with live WebTorrent stats (if the torrent is active in the client). */
function withLiveStats(dbTorrent) {
  const live = getTorrentStatus(dbTorrent.infoHash)
  return live ? { ...dbTorrent, ...live } : dbTorrent
}

// POST /api/torrents — add a torrent by magnet
router.post('/', authenticate, checkBalance, validateMagnet, async (req, res, next) => {
  try {
    const torrent = await addTorrent(req.body.magnet)

    await createTorrent(req.user.id, {
      infoHash:  torrent.infoHash,
      name:      torrent.name,
      magnetUri: req.body.magnet,
      sizeBytes: torrent.length,
      state:     'active',
    })

    ok(res, getTorrentStatus(torrent.infoHash), 201)
  } catch (err) {
    next(err)
  }
})

// GET /api/torrents — list this user's torrents with live stats
router.get('/', authenticate, async (req, res, next) => {
  try {
    const dbTorrents = await listTorrentsByUser(req.user.id)
    ok(res, dbTorrents.map(withLiveStats))
  } catch (err) {
    next(err)
  }
})

// GET /api/torrents/:hash/progress — SSE real-time stream
router.get('/:hash/progress', authenticate, async (req, res) => {
  const { hash } = req.params
  const dbTorrent = await getTorrent(req.user.id, hash)
  if (!dbTorrent) return fail(res, 'Torrent not found', 404)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const sendData = async () => {
    try {
      const [live, balance, user, fresh] = await Promise.all([
        Promise.resolve(getTorrentStatus(hash)),
        getBalance(req.user.id),
        getUserById(req.user.id),
        getTorrent(req.user.id, hash),
      ])
      const payload = {
        progress:            live?.progress    ?? 0,
        uploadSpeed:         live?.uploadSpeed ?? 0,
        numPeers:            live?.numPeers    ?? 0,
        balanceMicroCredits: balance,
        gracePeriodEndsAt:   user?.gracePeriodEndsAt  ?? null,
        scheduledDeleteAt:   fresh?.scheduledDeleteAt ?? null,
      }
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
    } catch {
      // skip this tick if DB read fails mid-stream
    }
  }

  await sendData()

  const dataInterval      = setInterval(sendData, 2_000)
  const keepaliveInterval = setInterval(() => res.write(': keepalive\n\n'), 15_000)

  const liveTorrent = client.torrents.find((t) => t.infoHash === hash)

  const onTorrentEnd = () => { cleanup(); res.end() }

  const cleanup = () => {
    clearInterval(dataInterval)
    clearInterval(keepaliveInterval)
    if (liveTorrent) {
      liveTorrent.off('done',  onTorrentEnd)
      liveTorrent.off('error', onTorrentEnd)
    }
  }

  if (liveTorrent) {
    liveTorrent.once('done',  onTorrentEnd)
    liveTorrent.once('error', onTorrentEnd)
  }

  req.on('close', cleanup)
})

// GET /api/torrents/:hash — single torrent
router.get('/:hash', authenticate, async (req, res, next) => {
  try {
    const dbTorrent = await getTorrent(req.user.id, req.params.hash)
    if (!dbTorrent) return fail(res, 'Torrent not found', 404)
    ok(res, withLiveStats(dbTorrent))
  } catch (err) {
    next(err)
  }
})

// DELETE /api/torrents/:hash — remove from client and DB
// ?destroyFiles=true also deletes files from disk
router.delete('/:hash', authenticate, async (req, res, next) => {
  try {
    const destroyStore = req.query.destroyFiles === 'true'
    await removeTorrent(req.params.hash, { destroyStore })
    await deleteTorrent(req.user.id, req.params.hash)
    ok(res, null)
  } catch (err) {
    next(err)
  }
})

export default router
