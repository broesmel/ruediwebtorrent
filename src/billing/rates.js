const CACHE_TTL_MS = 5 * 60 * 1000

const COINGECKO_IDS = { ltc: 'litecoin', xmr: 'monero' }

let cache = {}
let lastFetchAt = 0

export async function refreshRates() {
  const ids = Object.values(COINGECKO_IDS).join(',')
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    for (const [sym, id] of Object.entries(COINGECKO_IDS)) {
      if (data[id]?.usd != null) cache[sym] = data[id].usd
    }
    lastFetchAt = Date.now()
  } catch (err) {
    console.warn('[rates] refresh failed — using stale cache:', err.message)
  }
}

export function getRate(currency) {
  return cache[currency.toLowerCase()] ?? 0
}

export async function getRateWithRefresh(currency) {
  if (Date.now() - lastFetchAt > CACHE_TTL_MS) await refreshRates()
  return getRate(currency)
}
