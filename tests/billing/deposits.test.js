import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/chain/ltcNode.js', () => ({
  generateAddress: vi.fn(),
}))

vi.mock('../../src/chain/xmrNode.js', () => ({
  generateAddress: vi.fn(),
}))

vi.mock('../../src/db/repositories/depositRepo.js', () => ({
  createPendingDeposit: vi.fn(),
}))

import { createDepositAddress } from '../../src/billing/deposits.js'
import * as ltcNode from '../../src/chain/ltcNode.js'
import * as xmrNode from '../../src/chain/xmrNode.js'
import { createPendingDeposit } from '../../src/db/repositories/depositRepo.js'

beforeEach(() => vi.resetAllMocks())

describe('createDepositAddress', () => {
  it('calls ltcNode.generateAddress and creates pending deposit', async () => {
    ltcNode.generateAddress.mockResolvedValue({ address: 'Laddr123', userId: 7 })
    createPendingDeposit.mockResolvedValue()

    const address = await createDepositAddress(7, 'ltc')

    expect(address).toBe('Laddr123')
    expect(ltcNode.generateAddress).toHaveBeenCalledWith(7)
    expect(createPendingDeposit).toHaveBeenCalledWith(7, 'ltc', 'Laddr123')
  })

  it('calls xmrNode.generateAddress for xmr currency', async () => {
    xmrNode.generateAddress.mockResolvedValue({ address: '4BXmrAddr', userId: 3 })
    createPendingDeposit.mockResolvedValue()

    const address = await createDepositAddress(3, 'xmr')

    expect(address).toBe('4BXmrAddr')
    expect(xmrNode.generateAddress).toHaveBeenCalledWith(3)
    expect(createPendingDeposit).toHaveBeenCalledWith(3, 'xmr', '4BXmrAddr')
  })

  it('is case-insensitive for currency', async () => {
    ltcNode.generateAddress.mockResolvedValue({ address: 'Laddr999', userId: 1 })
    createPendingDeposit.mockResolvedValue()

    const address = await createDepositAddress(1, 'LTC')

    expect(address).toBe('Laddr999')
    expect(createPendingDeposit).toHaveBeenCalledWith(1, 'ltc', 'Laddr999')
  })

  it('throws for unsupported currency', async () => {
    await expect(createDepositAddress(1, 'btc')).rejects.toThrow('Unsupported currency: btc')
    expect(createPendingDeposit).not.toHaveBeenCalled()
  })

  it('propagates chain node errors', async () => {
    ltcNode.generateAddress.mockRejectedValue(new Error('wallet locked'))

    await expect(createDepositAddress(1, 'ltc')).rejects.toThrow('wallet locked')
    expect(createPendingDeposit).not.toHaveBeenCalled()
  })
})
