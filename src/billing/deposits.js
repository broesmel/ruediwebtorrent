import * as ltcNode  from '../chain/ltcNode.js'
import * as xmrNode  from '../chain/xmrNode.js'
import * as btcNode  from '../chain/btcNode.js'
import * as dogeNode from '../chain/dogeNode.js'
import * as zecNode  from '../chain/zecNode.js'
import { createPendingDeposit } from '../db/repositories/depositRepo.js'

const CHAIN_NODES = { ltc: ltcNode, xmr: xmrNode, btc: btcNode, doge: dogeNode, zec: zecNode }

/**
 * Generate a deposit address for the given user and currency,
 * then persist a pending deposit record.
 * Returns the address string.
 */
export async function createDepositAddress(userId, currency) {
  const key = currency.toLowerCase()
  const node = CHAIN_NODES[key]
  if (!node) throw new Error(`Unsupported currency: ${currency}`)

  const { address } = await node.generateAddress(userId)
  await createPendingDeposit(userId, key, address)
  return address
}
