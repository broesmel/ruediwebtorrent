// Accepts hex (40 chars) or base32 (32 chars) btih hashes
const MAGNET_RE = /^magnet:\?.*xt=urn:btih:([0-9a-fA-F]{40}|[A-Z2-7]{32})/i

/**
 * Middleware — validates req.body.magnet.
 * Responds 400 if missing or malformed.
 */
export function validateMagnet(req, res, next) {
  const { magnet } = req.body ?? {}

  if (!magnet || typeof magnet !== 'string') {
    return res.status(400).json({
      success: false,
      data: null,
      error: 'body.magnet is required',
    })
  }

  if (!MAGNET_RE.test(magnet)) {
    return res.status(400).json({
      success: false,
      data: null,
      error: 'Invalid magnet URI — must contain a valid xt=urn:btih: hash',
    })
  }

  next()
}
