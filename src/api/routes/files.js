import 'dotenv/config'
import { Router } from 'express'
import multer from 'multer'
import { resolve, join } from 'path'
import { unlink, mkdir } from 'fs/promises'
import { client } from '../../torrent/client.js'
import { createTorrent } from '../../db/repositories/torrentRepo.js'
import { authenticate } from '../middleware/auth.js'

const DATA_DIR = resolve(process.env.DATA_DIR ?? './data')
const TMP_DIR  = join(DATA_DIR, 'tmp')
const FILES_DIR = join(DATA_DIR, 'files')

// Ensure upload directories exist at module load
await mkdir(TMP_DIR,   { recursive: true })
await mkdir(FILES_DIR, { recursive: true })

const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB ?? 500)
const upload = multer({ dest: TMP_DIR, limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 } })

const router = Router()

const ok = (res, data, status = 200) =>
  res.status(status).json({ success: true, data, error: null })

/**
 * POST /api/files/upload
 * Accepts a multipart file, seeds it via WebTorrent, persists to DB.
 * Returns { infoHash, magnetUri, name, sizeBytes }.
 */
router.post('/upload', authenticate, upload.single('file'), async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ success: false, data: null, error: 'No file provided' })
  }

  const tmpPath = req.file.path

  try {
    // Seed the file — resolves once WebTorrent has computed metadata
    const torrent = await new Promise((resolve, reject) => {
      const t = client.seed(tmpPath, { path: FILES_DIR }, resolve)
      t.once('error', reject)
    })

    // Persist to DB: two keys in one batch (torrents:{userId}:{hash} + reverse index)
    await createTorrent(req.user.id, {
      infoHash:  torrent.infoHash,
      name:      torrent.name,
      magnetUri: torrent.magnetURI,
      sizeBytes: torrent.length,
      state:     'active',
    })

    // Remove the tmp copy — the seeded file lives in FILES_DIR now
    await unlink(tmpPath).catch(() => {})

    ok(res, {
      infoHash:  torrent.infoHash,
      magnetUri: torrent.magnetURI,
      name:      torrent.name,
      sizeBytes: torrent.length,
    }, 201)
  } catch (err) {
    await unlink(tmpPath).catch(() => {})
    next(err)
  }
})

export default router
