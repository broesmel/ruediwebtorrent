/**
 * Single source of truth for all LevelDB key strings.
 * No other file constructs key strings directly.
 */
export const keys = {
  user:             (id)              => `users:${id}`,
  userByEmail:      (email)           => `users:email:${email}`,

  torrent:          (userId, hash)    => `torrents:${userId}:${hash}`,
  torrentByHash:    (hash)            => `torrents:hash:${hash}`,
  torrentsPrefix:   (userId)          => `torrents:${userId}:`,

  transaction:      (userId, ts, ref) => `transactions:${userId}:${ts}:${ref}`,
  txPrefix:         (userId)          => `transactions:${userId}:`,

  depositPending:   (currency, addr)  => `deposits:pending:${currency}:${addr}`,
  depositConfirmed: (txid)            => `deposits:confirmed:${txid}`,

  balance:          (userId)          => `balance:${userId}`,

  chainHeight:      (chain)           => `chain:${chain}:lastHeight`,

  pricing:          (key)             => `pricing:${key}`,

  nextUserId:       ()                => `meta:nextUserId`,
}
