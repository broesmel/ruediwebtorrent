import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Patch global fetch before importing the module under test
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  generateAddress,
  getConfirmedDeposits,
  getCurrentHeight,
  getRequiredConfirmations,
} from '../../src/chain/zecNode.js'

function rpcOk(result) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ result, error: null }),
  })
}

function rpcErr(message) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ result: null, error: { message } }),
  })
}

beforeEach(() => mockFetch.mockReset())

afterEach(() => vi.restoreAllMocks())

describe('generateAddress', () => {
  it('calls getnewaddress with a user label and returns { address, userId }', async () => {
    mockFetch.mockResolvedValueOnce(rpcOk('t1ZecDummyAddress123'))

    const result = await generateAddress(5)

    expect(result).toEqual({ address: 't1ZecDummyAddress123', userId: 5 })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.method).toBe('getnewaddress')
    expect(body.params[0]).toContain('5')
  })

  it('throws when RPC returns an error', async () => {
    mockFetch.mockResolvedValueOnce(rpcErr('wallet locked'))
    await expect(generateAddress(1)).rejects.toThrow('wallet locked')
  })
})

describe('getConfirmedDeposits', () => {
  it('returns empty array when no receive transactions', async () => {
    mockFetch.mockResolvedValueOnce(rpcOk({ transactions: [] }))

    const deposits = await getConfirmedDeposits(0)
    expect(deposits).toEqual([])
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.method).toBe('listsinceblock')
  })

  it('fetches block hash when sinceHeight > 0', async () => {
    mockFetch
      .mockResolvedValueOnce(rpcOk('zecblockhash789'))            // getblockhash
      .mockResolvedValueOnce(rpcOk({ transactions: [] }))          // listsinceblock

    await getConfirmedDeposits(300)

    const hashCall = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(hashCall.method).toBe('getblockhash')
    expect(hashCall.params[0]).toBe(300)

    const listCall = JSON.parse(mockFetch.mock.calls[1][1].body)
    expect(listCall.method).toBe('listsinceblock')
    expect(listCall.params[0]).toBe('zecblockhash789')
  })

  it('maps receive transactions to deposit objects', async () => {
    const txs = [
      { category: 'receive', address: 't1ZAddr1', amount: 1.5, txid: 'zectx1', confirmations: 15 },
      { category: 'send',    address: 't1ZAddr2', amount: 0.5, txid: 'zectx2', confirmations: 15 },  // filtered out
    ]
    mockFetch.mockResolvedValueOnce(rpcOk({ transactions: txs }))

    const deposits = await getConfirmedDeposits(0)

    expect(deposits).toHaveLength(1)
    expect(deposits[0]).toEqual({ address: 't1ZAddr1', amount: 1.5, txid: 'zectx1', confirmations: 15 })
  })

  it('filters out under-confirmed transactions', async () => {
    const txs = [
      { category: 'receive', address: 't1Z1', amount: 1, txid: 'zectx1', confirmations: 5 },
    ]
    mockFetch.mockResolvedValueOnce(rpcOk({ transactions: txs }))

    const deposits = await getConfirmedDeposits(0)
    expect(deposits).toHaveLength(0)
  })
})

describe('getCurrentHeight', () => {
  it('returns current block count', async () => {
    mockFetch.mockResolvedValueOnce(rpcOk(2_400_000))
    expect(await getCurrentHeight()).toBe(2_400_000)
  })
})

describe('getRequiredConfirmations', () => {
  it('returns a positive integer', () => {
    expect(getRequiredConfirmations()).toBeGreaterThan(0)
  })
})
