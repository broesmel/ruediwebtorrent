import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../../src/db/db.js', async () => {
  const { MemoryLevel } = await import('memory-level')
  return { default: new MemoryLevel({ valueEncoding: 'utf8' }) }
})

import db from '../../src/db/db.js'
import {
  createPendingDeposit,
  getPendingDeposit,
  isDepositConfirmed,
  confirmDeposit,
} from '../../src/db/repositories/depositRepo.js'

beforeEach(async () => {
  await db.clear()
})

describe('createPendingDeposit / getPendingDeposit', () => {
  it('creates and retrieves a pending deposit', async () => {
    await createPendingDeposit(1, 'ltc', 'LAddressXYZ')
    const d = await getPendingDeposit('ltc', 'LAddressXYZ')
    expect(d).toMatchObject({ userId: 1, currency: 'ltc', address: 'LAddressXYZ' })
  })

  it('returns null for unknown address', async () => {
    expect(await getPendingDeposit('ltc', 'nope')).toBeNull()
  })
})

describe('isDepositConfirmed', () => {
  it('returns false before confirmation', async () => {
    expect(await isDepositConfirmed('txid123')).toBe(false)
  })

  it('returns true after confirmDeposit', async () => {
    await createPendingDeposit(1, 'ltc', 'LAddr')
    await confirmDeposit(1, {
      currency: 'ltc',
      address: 'LAddr',
      txid: 'txid123',
      microCredits: 5000,
      currentBalance: 0,
    })
    expect(await isDepositConfirmed('txid123')).toBe(true)
  })
})

describe('confirmDeposit', () => {
  it('credits balance, writes tx record, marks confirmed, removes pending', async () => {
    await createPendingDeposit(1, 'ltc', 'LAddr')

    const { newBalance, transaction } = await confirmDeposit(1, {
      currency: 'ltc',
      address: 'LAddr',
      txid: 'txabc',
      microCredits: 10_000,
      currentBalance: 2_000,
    })

    expect(newBalance).toBe(12_000)
    expect(transaction.type).toBe('deposit')
    expect(transaction.amount).toBe(10_000)
    expect(transaction.ref).toBe('txabc')

    // Pending entry removed
    expect(await getPendingDeposit('ltc', 'LAddr')).toBeNull()
    // Confirmed guard written
    expect(await isDepositConfirmed('txabc')).toBe(true)
  })
})
