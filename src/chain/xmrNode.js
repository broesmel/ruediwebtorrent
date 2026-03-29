import 'dotenv/config'

const HOST          = process.env.XMR_RPC_HOST       ?? '127.0.0.1'
const PORT          = process.env.XMR_RPC_PORT       ?? '18083'
const CONFIRMATIONS = Number(process.env.XMR_CONFIRMATIONS   ?? 10)
const ACCOUNT_INDEX = Number(process.env.XMR_WALLET_ACCOUNT  ?? 0)

const RPC_URL = `http://${HOST}:${PORT}/json_rpc`

const PICONERO = 1e12  // 1 XMR = 1e12 piconero

let _id = 0

async function rpc(method, params = {}) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: String(++_id), method, params }),
  })
  if (!res.ok) throw new Error(`XMR RPC HTTP ${res.status} on ${method}`)
  const json = await res.json()
  if (json.error) throw new Error(`XMR RPC: ${json.error.message}`)
  return json.result
}

/**
 * Create a new Monero subaddress for a user.
 * Uses `create_address` so each user gets an isolated deposit address.
 */
export async function generateAddress(userId) {
  const result = await rpc('create_address', {
    account_index: ACCOUNT_INDEX,
    label: `seedbox-user-${userId}`,
  })
  return { address: result.address, userId }
}

/**
 * Return all confirmed incoming transfers after `sinceHeight`.
 *
 * @param {number} sinceHeight  last processed block height (0 = all history)
 * @returns {Promise<Array<{ address, amount, txid, confirmations }>>}
 */
export async function getConfirmedDeposits(sinceHeight) {
  const params = {
    in:            true,
    account_index: ACCOUNT_INDEX,
  }
  if (sinceHeight > 0) {
    params.min_height       = sinceHeight
    params.filter_by_height = true
  }

  const result = await rpc('get_transfers', params)

  return (result.in ?? [])
    .filter((tx) => tx.confirmations >= CONFIRMATIONS)
    .map((tx) => ({
      address:       tx.address,
      amount:        tx.amount / PICONERO,  // piconero → XMR
      txid:          tx.txid,
      confirmations: tx.confirmations,
    }))
}

/** Current chain tip height. Used by the poller to advance lastHeight. */
export async function getCurrentHeight() {
  const result = await rpc('get_height')
  return result.height
}

export function getRequiredConfirmations() {
  return CONFIRMATIONS
}
