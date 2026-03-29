import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- mocks ---

vi.mock('../../src/chain/ltcNode.js', () => ({
  generateAddress:        vi.fn(),
  getConfirmedDeposits:   vi.fn(),
  getCurrentHeight:       vi.fn(),
  getRequiredConfirmations: vi.fn().mockReturnValue(6),
}))

vi.mock('../../src/chain/xmrNode.js', () => ({
  generateAddress:        vi.fn(),
  getConfirmedDeposits:   vi.fn(),
  getCurrentHeight:       vi.fn(),
  getRequiredConfirmations: vi.fn().mockReturnValue(10),
}))

vi.mock('../../src/db/repositories/depositRepo.js', () => ({
  getPendingDeposit:   vi.fn(),
  isDepositConfirmed:  vi.fn(),
  confirmDeposit:      vi.fn(),
  createPendingDeposit: vi.fn(),
}))

vi.mock('../../src/db/repositories/balanceRepo.js', () => ({
  getBalance: vi.fn(),
  setBalance: vi.fn(),
}))

vi.mock('../../src/billing/credits.js', () => ({
  cryptoToMicroCredits: vi.fn(),
}))

vi.mock('../../src/db/db.js', async () => {
  const { MemoryLevel } = await import('memory-level')
  return { default: new MemoryLevel({ valueEncoding: 'utf8' }) }
})

// --- imports ---

import { pollChain, processDeposit } from '../../src/chain/poller.js'
import * as ltcNode from '../../src/chain/ltcNode.js'
import { getPendingDeposit, isDepositConfirmed, confirmDeposit } from '../../src/db/repositories/depositRepo.js'
import { getBalance } from '../../src/db/repositories/balanceRepo.js'
import { cryptoToMicroCredits } from '../../src/billing/credits.js'
import db from '../../src/db/db.js'

beforeEach(async () => {
  vi.resetAllMocks()
  await db.clear()
})

// ---------------------------------------------------------------------------
// processDeposit
// ---------------------------------------------------------------------------
describe('processDeposit', () => {
  const deposit = { address: 'Laddr1', amount: 10, txid: 'tx1' }

  it('skips when txid is already confirmed (dedup)', async () => {
    isDepositConfirmed.mockResolvedValue(true)

    await processDeposit('ltc', deposit)

    expect(confirmDeposit).not.toHaveBeenCalled()
  })

  it('skips when no pending deposit record for address', async () => {
    isDepositConfirmed.mockResolvedValue(false)
    getPendingDeposit.mockResolvedValue(null)

    await processDeposit('ltc', deposit)

    expect(confirmDeposit).not.toHaveBeenCalled()
  })

  it('skips when micro-credits compute to 0', async () => {
    isDepositConfirmed.mockResolvedValue(false)
    getPendingDeposit.mockResolvedValue({ userId: 1, currency: 'ltc', address: 'Laddr1' })
    cryptoToMicroCredits.mockResolvedValue(0)

    await processDeposit('ltc', deposit)

    expect(confirmDeposit).not.toHaveBeenCalled()
  })

  it('calls confirmDeposit with correct args', async () => {
    isDepositConfirmed.mockResolvedValue(false)
    getPendingDeposit.mockResolvedValue({ userId: 5, currency: 'ltc', address: 'Laddr1' })
    cryptoToMicroCredits.mockResolvedValue(10_000)
    getBalance.mockResolvedValue(500)
    confirmDeposit.mockResolvedValue({ newBalance: 10_500 })

    await processDeposit('ltc', deposit)

    expect(confirmDeposit).toHaveBeenCalledWith(5, {
      currency:       'ltc',
      address:        'Laddr1',
      txid:           'tx1',
      microCredits:   10_000,
      currentBalance: 500,
    })
    expect(cryptoToMicroCredits).toHaveBeenCalledWith('ltc', 10)
  })
})

// ---------------------------------------------------------------------------
// pollChain
// ---------------------------------------------------------------------------
describe('pollChain', () => {
  it('advances lastHeight after a poll with no deposits', async () => {
    ltcNode.getConfirmedDeposits.mockResolvedValue([])
    ltcNode.getCurrentHeight.mockResolvedValue(200)

    await pollChain('ltc')

    const stored = await db.get('chain:ltc:lastHeight')
    expect(stored).toBe('200')
  })

  it('processes all returned deposits before advancing height', async () => {
    const dep1 = { address: 'A1', amount: 1, txid: 'tx1' }
    const dep2 = { address: 'A2', amount: 2, txid: 'tx2' }

    ltcNode.getConfirmedDeposits.mockResolvedValue([dep1, dep2])
    ltcNode.getCurrentHeight.mockResolvedValue(300)

    // Both deposits are already confirmed — quickest way to verify they were touched
    isDepositConfirmed.mockResolvedValue(true)

    await pollChain('ltc')

    expect(isDepositConfirmed).toHaveBeenCalledTimes(2)
    const stored = await db.get('chain:ltc:lastHeight')
    expect(stored).toBe('300')
  })

  it('passes the stored lastHeight to getConfirmedDeposits', async () => {
    await db.put('chain:ltc:lastHeight', '150')
    ltcNode.getConfirmedDeposits.mockResolvedValue([])
    ltcNode.getCurrentHeight.mockResolvedValue(160)

    await pollChain('ltc')

    expect(ltcNode.getConfirmedDeposits).toHaveBeenCalledWith(150)
  })

  it('does not throw when chain node errors — logs instead', async () => {
    ltcNode.getConfirmedDeposits.mockRejectedValue(new Error('node down'))
    ltcNode.getCurrentHeight.mockResolvedValue(0)

    // Should resolve without throwing
    await expect(pollChain('ltc')).resolves.toBeUndefined()
  })
})
