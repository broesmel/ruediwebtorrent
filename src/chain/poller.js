import 'dotenv/config'
import db from '../db/db.js'
import { keys } from '../db/keys.js'
import * as ltcNode from './ltcNode.js'
import * as xmrNode from './xmrNode.js'
import {
  getPendingDeposit,
  isDepositConfirmed,
  confirmDeposit,
} from '../db/repositories/depositRepo.js'
import { getBalance } from '../db/repositories/balanceRepo.js'
import { cryptoToMicroCredits } from '../billing/credits.js'

const POLL_INTERVAL_MS = Number(process.env.CHAIN_POLL_INTERVAL_MS ?? 60_000)

const CHAIN_NODES = { ltc: ltcNode, xmr: xmrNode }

async function getLastHeight(chain) {
  const raw = await db.get(keys.chainHeight(chain))
  return raw !== undefined ? Number(raw) : 0
}

async function setLastHeight(chain, height) {
  await db.put(keys.chainHeight(chain), String(height))
}

/**
 * Process a single confirmed on-chain deposit.
 * - Skips if already credited (dedup guard via deposits:confirmed:{txid}).
 * - Skips if no matching pending deposit record (unknown address).
 * - Converts amount to micro-credits and commits the batch atomically.
 */
async function processDeposit(currency, { address, amount, txid }) {
  if (await isDepositConfirmed(txid)) {
    console.log(`[poller:${currency}] ${txid} already credited — skip`)
    return
  }

  const pending = await getPendingDeposit(currency, address)
  if (!pending) {
    console.log(`[poller:${currency}] no pending deposit for ${address} — skip`)
    return
  }

  const microCredits = await cryptoToMicroCredits(currency, amount)
  if (microCredits <= 0) {
    console.warn(`[poller:${currency}] ${txid}: computed 0 µ-credits — skip`)
    return
  }

  const currentBalance = await getBalance(pending.userId)

  await confirmDeposit(pending.userId, {
    currency,
    address,
    txid,
    microCredits,
    currentBalance,
  })

  console.log(
    `[poller:${currency}] +${microCredits} µ-credits → user ${pending.userId} (${txid})`
  )
}

/**
 * Poll one chain: fetch confirmed deposits since lastHeight, process each,
 * then advance lastHeight to the current chain tip.
 */
async function pollChain(currency) {
  const node = CHAIN_NODES[currency]
  if (!node) return

  try {
    const sinceHeight = await getLastHeight(currency)
    const [deposits, newHeight] = await Promise.all([
      node.getConfirmedDeposits(sinceHeight),
      node.getCurrentHeight(),
    ])

    for (const deposit of deposits) {
      await processDeposit(currency, deposit)
    }

    await setLastHeight(currency, newHeight)

    if (deposits.length > 0 || newHeight > sinceHeight) {
      console.log(
        `[poller:${currency}] height ${sinceHeight}→${newHeight}, processed ${deposits.length} deposit(s)`
      )
    }
  } catch (err) {
    console.error(`[poller:${currency}] poll error: ${err.message}`)
  }
}

async function pollAll() {
  const currencies = (process.env.ACCEPTED_CURRENCIES ?? 'ltc,xmr')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  await Promise.all(currencies.map(pollChain))
}

/**
 * Start the polling loop. Fires once immediately, then on each interval.
 * Returns the interval handle so the caller can clear it on shutdown.
 */
export function startPoller() {
  console.log(`[poller] starting — interval ${POLL_INTERVAL_MS}ms`)
  pollAll()
  return setInterval(pollAll, POLL_INTERVAL_MS)
}

// Exported for testing
export { pollChain, processDeposit }
