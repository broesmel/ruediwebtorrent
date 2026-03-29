import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Patch global fetch before importing the module under test
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  generateAddress,
  getConfirmedDeposits,
  getCurrentHeight,
  getRequiredConfirmations,
} from '../../src/chain/ltcNode.js'

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
    mockFetch.mockResolvedValueOnce(rpcOk('LdummyAddress123'))

    const result = await generateAddress(42)

    expect(result).toEqual({ address: 'LdummyAddress123', userId: 42 })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.method).toBe('getnewaddress')
    expect(body.params[0]).toContain('42')
  })

  it('throws when RPC returns an error', async () => {
    mockFetch.mockResolvedValueOnce(rpcErr('wallet locked'))
    await expect(generateAddress(1)).rejects.toThrow('wallet locked')
  })
})

describe('getConfirmedDeposits', () => {
  it('returns empty array when no receive transactions', async () => {
    // sinceHeight=0 → no getblockhash call, straight to listsinceblock
    mockFetch.mockResolvedValueOnce(rpcOk({ transactions: [] }))

    const deposits = await getConfirmedDeposits(0)
    expect(deposits).toEqual([])
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.method).toBe('listsinceblock')
  })

  it('fetches block hash when sinceHeight > 0', async () => {
    mockFetch
      .mockResolvedValueOnce(rpcOk('blockhash123'))             // getblockhash
      .mockResolvedValueOnce(rpcOk({ transactions: [] }))       // listsinceblock

    await getConfirmedDeposits(100)

    const hashCall = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(hashCall.method).toBe('getblockhash')
    expect(hashCall.params[0]).toBe(100)

    const listCall = JSON.parse(mockFetch.mock.calls[1][1].body)
    expect(listCall.method).toBe('listsinceblock')
    expect(listCall.params[0]).toBe('blockhash123')
  })

  it('maps receive transactions to deposit objects', async () => {
    const txs = [
      { category: 'receive', address: 'Laddr1', amount: 2.5, txid: 'tx1', confirmations: 10 },
      { category: 'send',    address: 'Laddr2', amount: 1.0, txid: 'tx2', confirmations: 10 },  // filtered out
    ]
    mockFetch.mockResolvedValueOnce(rpcOk({ transactions: txs }))

    const deposits = await getConfirmedDeposits(0)

    expect(deposits).toHaveLength(1)
    expect(deposits[0]).toEqual({ address: 'Laddr1', amount: 2.5, txid: 'tx1', confirmations: 10 })
  })

  it('filters out under-confirmed transactions', async () => {
    const txs = [
      { category: 'receive', address: 'L1', amount: 1, txid: 'tx1', confirmations: 2 },
    ]
    mockFetch.mockResolvedValueOnce(rpcOk({ transactions: txs }))

    const deposits = await getConfirmedDeposits(0)
    expect(deposits).toHaveLength(0)
  })
})

describe('getCurrentHeight', () => {
  it('returns current block count', async () => {
    mockFetch.mockResolvedValueOnce(rpcOk(2_500_000))
    expect(await getCurrentHeight()).toBe(2_500_000)
  })
})

describe('getRequiredConfirmations', () => {
  it('returns a positive integer', () => {
    expect(getRequiredConfirmations()).toBeGreaterThan(0)
  })
})
