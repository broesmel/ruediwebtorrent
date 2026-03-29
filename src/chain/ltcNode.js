import 'dotenv/config'

const HOST         = process.env.LTC_RPC_HOST  ?? '127.0.0.1'
const PORT         = process.env.LTC_RPC_PORT  ?? '9332'
const USER         = process.env.LTC_RPC_USER  ?? ''
const PASS         = process.env.LTC_RPC_PASS  ?? ''
const CONFIRMATIONS = Number(process.env.LTC_CONFIRMATIONS ?? 6)

const RPC_URL = `http://${HOST}:${PORT}/`
const AUTH    = Buffer.from(`${USER}:${PASS}`).toString('base64')

let _id = 0

async function rpc(method, params = []) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${AUTH}`,
    },
    body: JSON.stringify({ jsonrpc: '1.0', id: String(++_id), method, params }),
  })
  if (!res.ok) throw new Error(`LTC RPC HTTP ${res.status} on ${method}`)
  const json = await res.json()
  if (json.error) throw new Error(`LTC RPC: ${json.error.message}`)
  return json.result
}

/**
 * Generate a new Litecoin address for a user.
 * Uses `getnewaddress` with a label so deposits can be traced.
 */
export async function generateAddress(userId) {
  const address = await rpc('getnewaddress', [`seedbox-user-${userId}`])
  return { address, userId }
}

/**
 * Return all confirmed incoming transactions after `sinceHeight`.
 * Uses `listsinceblock` so no transactions are missed between polls.
 *
 * @param {number} sinceHeight  last processed block height (0 = from genesis)
 * @returns {Promise<Array<{ address, amount, txid, confirmations }>>}
 */
export async function getConfirmedDeposits(sinceHeight) {
  let blockHash = ''
  if (sinceHeight > 0) {
    blockHash = await rpc('getblockhash', [sinceHeight])
  }

  const result = await rpc('listsinceblock', [blockHash, CONFIRMATIONS])

  return result.transactions
    .filter((tx) => tx.category === 'receive' && tx.confirmations >= CONFIRMATIONS)
    .map((tx) => ({
      address:       tx.address,
      amount:        tx.amount,      // LTC
      txid:          tx.txid,
      confirmations: tx.confirmations,
    }))
}

/** Current chain tip height. Used by the poller to advance lastHeight. */
export async function getCurrentHeight() {
  return rpc('getblockcount')
}

export function getRequiredConfirmations() {
  return CONFIRMATIONS
}
