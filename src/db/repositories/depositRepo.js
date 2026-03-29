import db from '../db.js'
import { keys } from '../keys.js'

export async function createPendingDeposit(userId, currency, address) {
  const deposit = { userId, currency, address, createdAt: Date.now() }
  await db.put(keys.depositPending(currency, address), JSON.stringify(deposit))
  return deposit
}

export async function getPendingDeposit(currency, address) {
  const raw = await db.get(keys.depositPending(currency, address))
  return raw !== undefined ? JSON.parse(raw) : null
}

/** Key existence check — true means this txid was already credited. */
export async function isDepositConfirmed(txid) {
  return (await db.get(keys.depositConfirmed(txid))) !== undefined
}

/**
 * Atomically credit a deposit:
 *   balance:{userId}                        += microCredits
 *   transactions:{userId}:{ts}:{txid}       → debit record
 *   deposits:confirmed:{txid}               → 'true'  (dedup guard)
 *   deposits:pending:{currency}:{address}   → deleted
 */
export async function confirmDeposit(userId, { currency, address, txid, microCredits, currentBalance }) {
  const newBalance = currentBalance + microCredits
  const ts = Date.now()
  const tx = {
    userId,
    type: 'deposit',
    amount: microCredits,
    ref: txid,
    description: `${currency} deposit confirmed`,
    createdAt: ts,
  }
  await db.batch([
    { type: 'put', key: keys.balance(userId),                  value: String(newBalance) },
    { type: 'put', key: keys.transaction(userId, ts, txid),    value: JSON.stringify(tx) },
    { type: 'put', key: keys.depositConfirmed(txid),           value: 'true' },
    { type: 'del', key: keys.depositPending(currency, address) },
  ])
  return { newBalance, transaction: tx }
}
