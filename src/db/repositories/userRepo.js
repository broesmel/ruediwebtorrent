import { createHash } from 'crypto'
import db from '../db.js'
import { keys } from '../keys.js'

/**
 * Create a user from an Ed25519 public key.
 * userId = sha256(pubkeyHex). Writes two keys atomically:
 *   users:{userId}          → user object
 *   users:pubkey:{pubkey}   → userId  (lookup index)
 */
export async function createUser({ pubkey }) {
  const userId = createHash('sha256').update(pubkey).digest('hex')
  const user = {
    id: userId,
    pubkey,
    isAdmin: false,
    gracePeriodEndsAt: null,
    createdAt: Date.now(),
  }
  await db.batch([
    { type: 'put', key: keys.user(userId),         value: JSON.stringify(user) },
    { type: 'put', key: keys.userByPubkey(pubkey), value: userId },
  ])
  return user
}

export async function getUserById(userId) {
  const raw = await db.get(keys.user(userId))
  return raw !== undefined ? JSON.parse(raw) : null
}

export async function getUserByPubkey(pubkeyHex) {
  const idRaw = await db.get(keys.userByPubkey(pubkeyHex))
  if (idRaw === undefined) return null
  return getUserById(idRaw)
}

export async function updateUser(userId, updates) {
  const user = await getUserById(userId)
  if (!user) throw new Error(`User ${userId} not found`)
  const updated = { ...user, ...updates }
  await db.put(keys.user(userId), JSON.stringify(updated))
  return updated
}

/** Scan all user records, skipping pubkey-index keys. */
export async function listAllUsers() {
  const users = []
  for await (const [key, value] of db.iterator({
    gte: 'users:',
    lte: 'users:~',
  })) {
    if (key.startsWith('users:pubkey:')) continue
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object') users.push(parsed)
    } catch {}
  }
  return users
}
