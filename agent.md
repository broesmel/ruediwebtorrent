# AGENT.md — ruediwebtorrent × decentral.ninja Integration

This file is the authoritative reference for any AI agent working on this codebase.
Read it fully before touching any file.

---

## Project overview

A Node.js WebTorrent seedbox and file hosting service designed for decentralized
chat systems. Users of **decentral.ninja** (a fully decentralized, accountless chat
system) can store and seed files through this service. They pay with cryptocurrency
(LTC, XMR) on a pay-per-use basis. No subscriptions, no Stripe, no fiat.

**Primary use case**: A user in decentral.ninja attaches a file to a chat message.
The browser-side `TorrentProvider` controller uploads the file to this service and
receives a `magnetURI`. The magnetURI is embedded in the chat message. Recipients
resolve the file from the torrent swarm — this server is one always-on seeder.

**Stack**: Node.js (ESM), Express, LevelDB (classic-level), WebTorrent, JWT
**Crypto**: Self-hosted Litecoin node (LTC) + Monero node (XMR)
**Auth**: Ed25519 keypair challenge-response (replaces email/bcrypt — see below)
**Runtime**: Node.js 20+, no browser code, no WebRTC
**Reference**: `webtorrent.md` — consult this for every WebTorrent API call. Do not
guess method signatures.

---

## Critical context: decentral.ninja architecture

decentral.ninja is a **fully decentralized, server-free chat system**:
- No accounts, no backend database, no login
- Identity = a locally-generated UID in `localStorage`
- Users have **SubtleCrypto (Ed25519) keypairs** per room for E2E encryption
- All shared state is a **Yjs CRDT document**, synced peer-to-peer via WebSocket
  and/or WebRTC providers
- The frontend is pure ES modules — no build step, no framework, no bundler
- Components communicate via **DOM CustomEvents** — never direct method calls

This service must integrate with that model. It cannot require email, passwords, or
any traditional account creation.

---

## Auth model — Ed25519 keypair challenge-response

**This replaces the previous email/bcrypt auth completely.**

### Why keypair auth

- decentral.ninja users have no email or password — they cannot register traditionally
- SubtleCrypto is already used in the frontend for E2E encryption
- A stable Ed25519 keypair in `localStorage` gives a persistent, portable identity
- If a user loses their keypair, they lose access to their balance — same as losing a
  crypto wallet. This is acceptable and consistent with the decentralized ethos.

### Identity model

- Each user generates a **dedicated Ed25519 keypair** for ruediwebtorrent auth
- This keypair is stored in `localStorage` by `TorrentProvider.js` in the browser
- The **public key (hex-encoded, 64 chars)** is the stable user identifier
- `userId` in LevelDB is `sha256(pubkeyHex)` — a 64-char hex string
- There is no email, no password, no `nextUserId` counter

### Auth flow

```
1. Browser: GET /api/auth/challenge
   ← { nonce: "<32-byte hex>", expiresAt: <timestamp ms> }

2. Browser: signs nonce with Ed25519 private key (SubtleCrypto)
   → POST /api/auth/login { pubkey: "<hex>", signature: "<hex>" }
   ← { token: "<JWT>", user: { id, isAdmin } }

3. JWT stored in localStorage, sent as Bearer token on all subsequent requests
```

### Server-side challenge verification

Use Node.js `crypto.subtle.verify` (available in Node 20+):
```js
import { webcrypto } from 'crypto'
const subtle = webcrypto.subtle

// Import public key from raw bytes
const keyBytes = Buffer.from(pubkeyHex, 'hex')
const cryptoKey = await subtle.importKey(
  'raw', keyBytes, { name: 'Ed25519' }, false, ['verify']
)

// Verify signature over nonce
const sigBytes   = Buffer.from(signatureHex, 'hex')
const nonceBytes = Buffer.from(nonce, 'utf8')  // or hex — must match client
const valid = await subtle.verify('Ed25519', cryptoKey, sigBytes, nonceBytes)
```

Challenges are short-lived (60 seconds). Store pending challenges in an in-memory
`Map<nonce, expiresAt>` — not in LevelDB. Expired challenges are rejected and deleted.

### JWT payload

```js
{ id: sha256(pubkeyHex), pubkey: pubkeyHex, isAdmin: false }
```

`req.user = { id, pubkey, isAdmin }` after `authenticate` middleware runs.

---

## Database — LevelDB

The entire persistence layer is a single LevelDB instance (`classic-level` package).
Structure is imposed entirely through key naming conventions. **Never deviate.**

### Key conventions

```
users:{userId}                     → User object (userId = sha256 of pubkey hex)
users:pubkey:{pubkeyHex}           → userId  (index for login lookup — replaces email index)

torrents:{userId}:{infoHash}       → Torrent object
torrents:hash:{infoHash}           → userId  (reverse index)

transactions:{userId}:{timestampMs}:{txRef} → Transaction object

deposits:pending:{currency}:{address} → Deposit object
deposits:confirmed:{txid}          → 'true'  (dedup guard)

balance:{userId}                   → integer (micro-credits, stored as string)

chain:ltc:lastHeight               → integer (last processed LTC block height)
chain:xmr:lastHeight               → integer (last processed XMR block height)

pricing:gb_hour                    → integer (micro-credits per GB-hour)
```

**Removed from original schema**: `users:email:{email}` and `meta:nextUserId`.
`userId` is now derived from the pubkey — no counter needed.

### `src/db/keys.js` — the single source of key strings

```js
export const keys = {
  user:             (id)              => `users:${id}`,
  userByPubkey:     (pubkey)          => `users:pubkey:${pubkey}`,

  torrent:          (userId, hash)    => `torrents:${userId}:${hash}`,
  torrentByHash:    (hash)            => `torrents:hash:${hash}`,
  torrentsPrefix:   (userId)          => `torrents:${userId}:`,

  transaction:      (userId, ts, ref) => `transactions:${userId}:${ts}:${ref}`,
  txPrefix:         (userId)          => `transactions:${userId}:`,

  depositPending:   (currency, addr)  => `deposits:pending:${currency}:${addr}`,
  depositConfirmed: (txid)            => `deposits:confirmed:${txid}`,

  balance:          (userId)          => `balance:${userId}`,

  chainHeight:      (chain)           => `chain:${chain}:lastHeight`,

  pricing:          (key)             => `pricing:${key}`,
}
```

**No `nextUserId` key** — no longer needed.

### Reading patterns

**Get one record**:
```js
const raw = await db.get(keys.user(userId))
const user = raw !== undefined ? JSON.parse(raw) : null
```

**Prefix scan** (e.g. all torrents for a user):
```js
for await (const [, value] of db.iterator({
  gte: keys.torrentsPrefix(userId),
  lte: keys.torrentsPrefix(userId) + '~',
})) {
  torrents.push(JSON.parse(value))
}
```

**Check key existence** (e.g. deposit dedup):
```js
// abstract-level v3: missing keys return undefined, they do NOT throw
const exists = (await db.get(keys.depositConfirmed(txid))) !== undefined
```

### Atomic writes — use batches

```js
// Credit a deposit atomically
await db.batch([
  { type: 'put', key: keys.balance(userId),                  value: String(newBalance) },
  { type: 'put', key: keys.transaction(userId, ts, txid),    value: JSON.stringify(tx) },
  { type: 'put', key: keys.depositConfirmed(txid),           value: 'true' },
  { type: 'del', key: keys.depositPending(currency, address) },
])
```

**Never write multiple keys with separate `db.put()` calls when atomicity matters.**

---

## Directory structure

```
src/
  db/
    db.js                  # opens and exports the single LevelDB instance
    keys.js                # all key-builder functions — the only place key strings are built
    repositories/
      userRepo.js          # createUser({ pubkey }), getUserById, getUserByPubkey, updateUser
      torrentRepo.js
      transactionRepo.js
      depositRepo.js
      balanceRepo.js
  torrent/
    client.js              # WebTorrent singleton
    seeder.js              # re-seeds active torrents on startup
  api/
    server.js              # Express app factory
    routes/
      auth.js              # GET /challenge, POST /login (keypair auth)
      torrents.js
      files.js
      billing.js
      admin.js
    middleware/
      auth.js              # JWT → req.user = { id, pubkey, isAdmin }
      balance.js           # 402 if grace period expired
  billing/
    deposits.js            # unified deposit interface
    credits.js             # crypto amount → micro-credits
    rates.js               # CoinGecko rate cache
  chain/
    ltcNode.js
    xmrNode.js
    poller.js              # polls both chains on interval
  jobs/
    usageMeter.js          # every 60s — debits GB-hour costs
    balanceEnforcer.js     # every 60s — grace / pause / schedule delete pipeline
    fileReaper.js          # every 60s — executes scheduled deletions
  scripts/
    seed.js                # writes default pricing keys to LevelDB
tests/
  db/
  api/
  jobs/
  chain/
  e2e.test.js
webtorrent.md
.env.example
```

---

## Architectural decisions

### 1. Crypto payment provider

- **Litecoin**: Local `litecoind` with RPC. Addresses via `getnewaddress`.
  Deposits detected by polling `listsinceblock` keyed against `chain:ltc:lastHeight`.
- **Monero**: Local `monero-wallet-rpc`. Subaddresses via `create_address` per user.
  Deposits detected via `get_transfers` polling keyed against `chain:xmr:lastHeight`.

Both nodes are accessed through `src/chain/ltcNode.js` and `src/chain/xmrNode.js`.
Nothing outside `src/billing/deposits.js` calls chain modules directly.

### 2. Billing unit: GB-hours

```
gbHours = (torrent.sizeBytes / 1e9) * (intervalSeconds / 3600)
cost    = Math.ceil(gbHours * RATE_GB_HOUR)   // micro-credits, ceiling favours service
```

The meter runs every 60 seconds. Paused torrents are skipped. `RATE_GB_HOUR` is stored
under `pricing:gb_hour` in LevelDB and readable from `.env`.

### 3. Balance zero → delete files after X days

```
Balance hits 0
  → set user.gracePeriodEndsAt = NOW + GRACE_PERIOD_DAYS
  → torrents continue seeding during grace period

Grace period expires
  → pause all user torrents (state = 'paused')
  → set torrent.scheduledDeleteAt = gracePeriodEndsAt + DELETE_AFTER_DAYS

scheduledDeleteAt passes
  → destroy torrent, delete files from disk
  → set torrent.state = 'deleted'

User tops up at any point before deletion
  → clear gracePeriodEndsAt + scheduledDeleteAt
  → resume all paused torrents
```

Files deleted cannot be recovered. `fileReaper.js` is the **only** place that deletes
files from disk.

---

## Core rules — always follow these

- One `db` instance for the entire process. Open once in `src/db/db.js`, export it.
- Always use `keys.js` to build key strings. Never interpolate keys inline.
- Always use `db.batch()` when writing more than one key atomically.
- `JSON.stringify` objects on write, `JSON.parse` on read. Balances as `String(n)`.
- Missing keys: `db.get()` returns `undefined`. Check `=== undefined`, never try/catch.
- Prefix scans: `gte: prefix`, `lte: prefix + '~'`.
- All repository methods are `async`. Never mix sync and async DB access.
- Route handlers are thin — logic lives in repositories and `src/billing/`.
- Never call chain modules outside `src/billing/deposits.js`.
- Never delete files from disk outside `src/jobs/fileReaper.js`.
- Consult `webtorrent.md` before any WebTorrent API call.

---

## API conventions

- All responses: `{ success: boolean, data: any, error: string | null }`
- Status codes: `200` ok, `201` created, `400` bad request, `401` unauthenticated,
  `402` balance depleted and grace expired, `403` forbidden, `404` not found, `500` server error
- Middleware order: `authenticate` → `checkBalance` → handler
- CORS must be enabled — the browser client on decentral.ninja calls this API cross-origin

---

## Environment variables

```
PORT=3000
DATA_DIR=./data
LEVEL_PATH=./data/db

# Auth
JWT_SECRET=                   # min 32 chars
JWT_EXPIRY=7d

# Credits
CREDIT_USD_VALUE=0.001        # 1 credit = $0.001 USD
RATE_GB_HOUR=5                # micro-credits per GB-hour

# Balance lifecycle
GRACE_PERIOD_DAYS=3
DELETE_AFTER_DAYS=7

# Litecoin node
LTC_RPC_HOST=127.0.0.1
LTC_RPC_PORT=9332
LTC_RPC_USER=
LTC_RPC_PASS=
LTC_CONFIRMATIONS=6

# Monero wallet RPC
XMR_RPC_HOST=127.0.0.1
XMR_RPC_PORT=18083
XMR_CONFIRMATIONS=10
XMR_WALLET_ACCOUNT=0

# Chain poller
CHAIN_POLL_INTERVAL_MS=60000

# Accepted currencies
ACCEPTED_CURRENCIES=ltc,xmr

# CORS — set to decentral.ninja origin in production
CORS_ORIGIN=https://decentral.ninja
```

---

## Testing

- Mock `src/db/db.js` with `MemoryLevel` from `memory-level` package in all tests.
- Mock `src/chain/ltcNode.js` and `src/chain/xmrNode.js` — no real node calls.
- Mock `src/billing/rates.js` — no real CoinGecko calls.
- Mock the WebTorrent client in job and route tests.
- Auth tests must cover: valid challenge → valid signature → JWT issued; expired nonce
  rejected; invalid signature rejected; unknown pubkey → user auto-created on first login.
- The e2e suite covers: keypair login → deposit (mocked) → upload file → poll progress
  → balance drains → grace period set → pause → scheduledDeleteAt set → top-up →
  resume → deadlines cleared.
- Run: `npm test`

---

## npm scripts

```
npm start          # start the server
npm run dev        # nodemon watch
npm test           # all tests
npm run db:seed    # write default pricing keys to LevelDB
```

---

## Milestones

| # | Name | Status |
|---|------|--------|
| 1 | Project scaffold & WebTorrent core | ✅ done |
| 2 | LevelDB setup — db.js, keys.js, repositories | ✅ done |
| 3 | REST API layer + file upload & seeding | ✅ done |
| 4 | Auth & balance middleware | ✅ done |
| 5 | Chain modules — LTC + XMR node clients & deposit poller | ✅ done |
| 6 | Credit conversion & deposit flow | ✅ done |
| 7 | Usage metering, balance enforcer & file reaper jobs | ✅ done |
| 8 | Real-time progress & hardening | ✅ done |
| 9 | **decentral.ninja integration — keypair auth** | 🔲 todo |
| 10 | **decentral.ninja integration — TorrentProvider browser module** | 🔲 todo |
| 11 | **CORS, rate limiting & production hardening** | 🔲 todo |

---

## Out of scope

- No browser/frontend within this repo — backend API only
- No WebRTC — Node.js TCP/UDP only
- No fiat payments, no Stripe, no third-party payment APIs
- No multiple server instances — LevelDB is single-process only
- No Docker or deployment config
- No automatic node setup — `litecoind` and `monero-wallet-rpc` must be running before start
