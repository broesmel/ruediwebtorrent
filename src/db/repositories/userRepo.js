import db from '../db.js'
import { keys } from '../keys.js'

/**
 * Auto-increment user ID — NOT atomic under concurrent async calls.
 * Safe in a single-process Node.js service where callers await in sequence.
 */
export async function getNextUserId() {
  const raw = await db.get(keys.nextUserId())
  const current = raw !== undefined ? Number(raw) : 0
  const next = current + 1
  await db.put(keys.nextUserId(), String(next))
  return next
}

/**
 * Create a user. Writes two keys atomically:
 *   users:{id}           → user object
 *   users:email:{email}  → id  (lookup index)
 */
export async function createUser({ email, passwordHash }) {
  const id = await getNextUserId()
  const user = {
    id,
    email,
    passwordHash,
    isAdmin: false,
    gracePeriodEndsAt: null,
    createdAt: Date.now(),
  }
  await db.batch([
    { type: 'put', key: keys.user(id),          value: JSON.stringify(user) },
    { type: 'put', key: keys.userByEmail(email), value: String(id) },
  ])
  return user
}

export async function getUserById(userId) {
  const raw = await db.get(keys.user(userId))
  return raw !== undefined ? JSON.parse(raw) : null
}

export async function getUserByEmail(email) {
  const idRaw = await db.get(keys.userByEmail(email))
  if (idRaw === undefined) return null
  return getUserById(Number(idRaw))
}

export async function updateUser(userId, updates) {
  const user = await getUserById(userId)
  if (!user) throw new Error(`User ${userId} not found`)
  const updated = { ...user, ...updates }
  await db.put(keys.user(userId), JSON.stringify(updated))
  return updated
}

/** Scan all user records, skipping email-index keys. */
export async function listAllUsers() {
  const users = []
  for await (const [key, value] of db.iterator({
    gte: 'users:',
    lte: 'users:~',
  })) {
    if (key.startsWith('users:email:')) continue
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object') users.push(parsed)
    } catch {}
  }
  return users
}
