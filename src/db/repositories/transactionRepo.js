import db from '../db.js'
import { keys } from '../keys.js'

/**
 * Write a transaction record.
 * Prefer calling this inside a db.batch() together with the balance update
 * so both writes are atomic.
 *
 * @param {number} userId
 * @param {{ type: string, amount: number, ref: string, description?: string }} tx
 */
export async function createTransaction(userId, { type, amount, ref, description = '' }) {
  const ts = Date.now()
  const record = { userId, type, amount, ref, description, createdAt: ts }
  await db.put(keys.transaction(userId, ts, ref), JSON.stringify(record))
  return record
}

/** Prefix scan — returns all transactions for a user ordered by timestamp. */
export async function listTransactions(userId) {
  const records = []
  for await (const [, value] of db.iterator({
    gte: keys.txPrefix(userId),
    lte: keys.txPrefix(userId) + '~',
  })) {
    records.push(JSON.parse(value))
  }
  return records
}
