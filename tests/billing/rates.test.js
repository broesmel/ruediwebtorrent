import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Import after stubbing fetch so the module picks up the mock
import { refreshRates, getRate, getRateWithRefresh } from '../../src/billing/rates.js'

function cgOk(ltcUsd, xmrUsd) {
  return Promise.resolve({
    ok:   true,
    json: () => Promise.resolve({
      litecoin: { usd: ltcUsd },
      monero:   { usd: xmrUsd },
    }),
  })
}

function cgFail(status = 503) {
  return Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) })
}

beforeEach(() => {
  mockFetch.mockReset()
  // Reset module-level cache between tests by forcing a stale timestamp via refreshRates
})

describe('refreshRates', () => {
  it('populates cache from CoinGecko response', async () => {
    mockFetch.mockResolvedValueOnce(cgOk(80, 160))

    await refreshRates()

    expect(getRate('ltc')).toBe(80)
    expect(getRate('xmr')).toBe(160)
  })

  it('logs warning and keeps stale cache on HTTP error', async () => {
    // First load real values
    mockFetch.mockResolvedValueOnce(cgOk(80, 160))
    await refreshRates()

    // Now simulate failure
    mockFetch.mockResolvedValueOnce(cgFail())
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await refreshRates()

    expect(getRate('ltc')).toBe(80)  // stale value preserved
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('logs warning and keeps stale cache on fetch rejection', async () => {
    mockFetch.mockResolvedValueOnce(cgOk(80, 160))
    await refreshRates()

    mockFetch.mockRejectedValueOnce(new Error('network down'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await refreshRates()

    expect(getRate('ltc')).toBe(80)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('getRate', () => {
  it('returns 0 for unknown currency', async () => {
    expect(getRate('btc')).toBe(0)
  })

  it('is case-insensitive', async () => {
    mockFetch.mockResolvedValueOnce(cgOk(50, 100))
    await refreshRates()
    expect(getRate('LTC')).toBe(50)
  })
})

describe('getRateWithRefresh', () => {
  it('fetches if cache is fresh enough', async () => {
    // Seed fresh cache
    mockFetch.mockResolvedValueOnce(cgOk(90, 180))
    await refreshRates()
    mockFetch.mockReset()

    const rate = await getRateWithRefresh('ltc')

    // Should NOT have called fetch again (cache still fresh)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(rate).toBe(90)
  })
})
