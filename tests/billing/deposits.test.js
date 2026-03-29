import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/chain/ltcNode.js',  () => ({ generateAddress: vi.fn() }))
vi.mock('../../src/chain/xmrNode.js',  () => ({ generateAddress: vi.fn() }))
vi.mock('../../src/chain/btcNode.js',  () => ({ generateAddress: vi.fn() }))
vi.mock('../../src/chain/dogeNode.js', () => ({ generateAddress: vi.fn() }))
vi.mock('../../src/chain/zecNode.js',  () => ({ generateAddress: vi.fn() }))

vi.mock('../../src/db/repositories/depositRepo.js', () => ({
  createPendingDeposit: vi.fn(),
}))

import { createDepositAddress } from '../../src/billing/deposits.js'
import * as ltcNode  from '../../src/chain/ltcNode.js'
import * as xmrNode  from '../../src/chain/xmrNode.js'
import * as btcNode  from '../../src/chain/btcNode.js'
import * as dogeNode from '../../src/chain/dogeNode.js'
import * as zecNode  from '../../src/chain/zecNode.js'
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

  it('calls btcNode.generateAddress for btc currency', async () => {
    btcNode.generateAddress.mockResolvedValue({ address: '1BtcAddr', userId: 2 })
    createPendingDeposit.mockResolvedValue()

    const address = await createDepositAddress(2, 'btc')

    expect(address).toBe('1BtcAddr')
    expect(btcNode.generateAddress).toHaveBeenCalledWith(2)
    expect(createPendingDeposit).toHaveBeenCalledWith(2, 'btc', '1BtcAddr')
  })

  it('calls dogeNode.generateAddress for doge currency', async () => {
    dogeNode.generateAddress.mockResolvedValue({ address: 'DDogeAddr', userId: 4 })
    createPendingDeposit.mockResolvedValue()

    const address = await createDepositAddress(4, 'doge')

    expect(address).toBe('DDogeAddr')
    expect(dogeNode.generateAddress).toHaveBeenCalledWith(4)
    expect(createPendingDeposit).toHaveBeenCalledWith(4, 'doge', 'DDogeAddr')
  })

  it('calls zecNode.generateAddress for zec currency', async () => {
    zecNode.generateAddress.mockResolvedValue({ address: 't1ZecAddr', userId: 6 })
    createPendingDeposit.mockResolvedValue()

    const address = await createDepositAddress(6, 'zec')

    expect(address).toBe('t1ZecAddr')
    expect(zecNode.generateAddress).toHaveBeenCalledWith(6)
    expect(createPendingDeposit).toHaveBeenCalledWith(6, 'zec', 't1ZecAddr')
  })

  it('is case-insensitive for currency', async () => {
    ltcNode.generateAddress.mockResolvedValue({ address: 'Laddr999', userId: 1 })
    createPendingDeposit.mockResolvedValue()

    const address = await createDepositAddress(1, 'LTC')

    expect(address).toBe('Laddr999')
    expect(createPendingDeposit).toHaveBeenCalledWith(1, 'ltc', 'Laddr999')
  })

  it('throws for unsupported currency', async () => {
    await expect(createDepositAddress(1, 'eth')).rejects.toThrow('Unsupported currency: eth')
    expect(createPendingDeposit).not.toHaveBeenCalled()
  })

  it('propagates chain node errors', async () => {
    ltcNode.generateAddress.mockRejectedValue(new Error('wallet locked'))

    await expect(createDepositAddress(1, 'ltc')).rejects.toThrow('wallet locked')
    expect(createPendingDeposit).not.toHaveBeenCalled()
  })
})
