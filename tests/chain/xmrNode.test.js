import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  generateAddress,
  getConfirmedDeposits,
  getCurrentHeight,
  getRequiredConfirmations,
} from '../../src/chain/xmrNode.js'

function rpcOk(result) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ result, error: null }),
  })
}

function rpcErr(message) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ result: null, error: { code: -1, message } }),
  })
}

beforeEach(() => mockFetch.mockReset())

describe('generateAddress', () => {
  it('calls create_address and returns { address, userId }', async () => {
    mockFetch.mockResolvedValueOnce(rpcOk({
      address: '4BSubaddressXYZ',
      address_index: 1,
    }))

    const result = await generateAddress(7)

    expect(result).toEqual({ address: '4BSubaddressXYZ', userId: 7 })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.method).toBe('create_address')
    expect(body.params.label).toContain('7')
  })

  it('throws on RPC error', async () => {
    mockFetch.mockResolvedValueOnce(rpcErr('no wallet'))
    await expect(generateAddress(1)).rejects.toThrow('no wallet')
  })
})

describe('getConfirmedDeposits', () => {
  it('returns empty array when no incoming transfers', async () => {
    mockFetch.mockResolvedValueOnce(rpcOk({ in: [] }))
    expect(await getConfirmedDeposits(0)).toEqual([])
  })

  it('converts piconero to XMR', async () => {
    mockFetch.mockResolvedValueOnce(rpcOk({
      in: [{
        address:       '4BXmrAddr',
        amount:        2_500_000_000_000,  // 2.5 XMR in piconero
        txid:          'xmrtxid1',
        confirmations: 15,
        height:        3_000_000,
      }],
    }))

    const deposits = await getConfirmedDeposits(0)

    expect(deposits).toHaveLength(1)
    expect(deposits[0].amount).toBeCloseTo(2.5)
    expect(deposits[0].txid).toBe('xmrtxid1')
  })

  it('filters out under-confirmed transfers', async () => {
    mockFetch.mockResolvedValueOnce(rpcOk({
      in: [{ address: '4B1', amount: 1e12, txid: 'tx1', confirmations: 3, height: 1 }],
    }))
    expect(await getConfirmedDeposits(0)).toHaveLength(0)
  })

  it('includes min_height filter when sinceHeight > 0', async () => {
    mockFetch.mockResolvedValueOnce(rpcOk({ in: [] }))

    await getConfirmedDeposits(500_000)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.params.min_height).toBe(500_000)
    expect(body.params.filter_by_height).toBe(true)
  })

  it('handles missing `in` key gracefully', async () => {
    mockFetch.mockResolvedValueOnce(rpcOk({}))
    expect(await getConfirmedDeposits(0)).toEqual([])
  })
})

describe('getCurrentHeight', () => {
  it('returns height from get_height result', async () => {
    mockFetch.mockResolvedValueOnce(rpcOk({ height: 3_100_000 }))
    expect(await getCurrentHeight()).toBe(3_100_000)
  })
})

describe('getRequiredConfirmations', () => {
  it('returns a positive integer', () => {
    expect(getRequiredConfirmations()).toBeGreaterThan(0)
  })
})
