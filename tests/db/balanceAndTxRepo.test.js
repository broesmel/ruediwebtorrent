import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../../src/db/db.js', async () => {
  const { MemoryLevel } = await import('memory-level')
  return { default: new MemoryLevel({ valueEncoding: 'utf8' }) }
})

import db from '../../src/db/db.js'
import { getBalance, setBalance } from '../../src/db/repositories/balanceRepo.js'
import { createTransaction, listTransactions } from '../../src/db/repositories/transactionRepo.js'

beforeEach(async () => {
  await db.clear()
})

// ---------------------------------------------------------------------------
// balanceRepo
// ---------------------------------------------------------------------------
describe('getBalance', () => {
  it('defaults to 0 for new users', async () => {
    expect(await getBalance(1)).toBe(0)
  })
})

describe('setBalance / getBalance', () => {
  it('round-trips the value', async () => {
    await setBalance(1, 75_000)
    expect(await getBalance(1)).toBe(75_000)
  })

  it('allows negative balance (debt)', async () => {
    await setBalance(1, -500)
    expect(await getBalance(1)).toBe(-500)
  })
})

// ---------------------------------------------------------------------------
// transactionRepo
// ---------------------------------------------------------------------------
describe('createTransaction', () => {
  it('writes and returns a record', async () => {
    const tx = await createTransaction(1, {
      type: 'debit',
      amount: -250,
      ref: 'meter-run-1',
      description: 'GB-hour charge',
    })
    expect(tx).toMatchObject({ userId: 1, type: 'debit', amount: -250, ref: 'meter-run-1' })
    expect(tx.createdAt).toBeTypeOf('number')
  })
})

describe('listTransactions', () => {
  it('returns transactions in insertion order', async () => {
    await createTransaction(1, { type: 'deposit', amount: 5000, ref: 'tx1' })
    await createTransaction(1, { type: 'debit',   amount: -100, ref: 'tx2' })
    const list = await listTransactions(1)
    expect(list).toHaveLength(2)
    expect(list[0].ref).toBe('tx1')
    expect(list[1].ref).toBe('tx2')
  })

  it('returns empty array for user with no transactions', async () => {
    expect(await listTransactions(99)).toEqual([])
  })

  it('does not return transactions for other users', async () => {
    await createTransaction(1, { type: 'deposit', amount: 1000, ref: 'txA' })
    await createTransaction(2, { type: 'deposit', amount: 2000, ref: 'txB' })
    const list = await listTransactions(1)
    expect(list.every((t) => t.userId === 1)).toBe(true)
  })
})
