import db from '../db.js'
import { keys } from '../keys.js'

/** Returns micro-credit balance. Defaults to 0 for new users. */
export async function getBalance(userId) {
  const raw = await db.get(keys.balance(userId))
  return raw !== undefined ? Number(raw) : 0
}

/**
 * Overwrite balance directly.
 * Prefer using db.batch() in callers that also write transaction records
 * so the balance update and the record are committed atomically.
 */
export async function setBalance(userId, amount) {
  await db.put(keys.balance(userId), String(amount))
}
