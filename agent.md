# AGENT.md — WebTorrent Decentralized File Hosting Service

This file is the authoritative reference for any AI agent working on this codebase.
Read it fully before touching any file.

---

## Project overview

A Node.js WebTorrent seedbox and file hosting service designed for decentralized
chat systems. Users register, top up an account balance with cryptocurrency (LTC, XMR),
and pay for usage as they go. No subscriptions, no Stripe, no fiat.

**Primary use case**: A decentralized chat system stores and seeds files through this
service. Files are addressed by their torrent info hash. Users are charged for active
seeding time combined with file size — the longer and larger, the more it costs.

**Stack**: Node.js (ESM), Express, LevelDB (classic-level), WebTorrent, JWT, bcrypt
**Crypto**: Self-hosted Litecoin node (LTC) + Monero node (XMR)
**Runtime**: Node.js 20+, no browser code, no WebRTC
**Reference**: `webtorrent.md` — consult this for every WebTorrent API call.
Do not guess method signatures.

---

## Database — LevelDB

The entire persistence layer is a single LevelDB instance (`classic-level` package).
LevelDB is a key-value store. There are no tables, no SQL, no schema enforcement.
Structure is imposed entirely through key naming conventions defined in this file.
**Never deviate from the key conventions below** — the whole query model depends on them.

### Why LevelDB

- Fully async, Promise-based — never blocks the event loop.
- Extremely fast at small sequential writes — exactly the billing meter pattern.
- No separate process, no configuration, zero ops overhead.
- Single writer, concurrent readers — fits a single-server Node.js process perfectly.

### Key conventions

All keys follow the pattern `{namespace}:{subkey}`. Namespaces are fixed strings.
Lexicographic ordering within a namespace enables prefix scans using `db.iterator`.

```
users:{userId}                     → User object
users:email:{email}                → userId  (index for login lookup)

torrents:{userId}:{infoHash}       → Torrent object
torrents:hash:{infoHash}           → userId  (reverse index, for admin/webhook lookup)

transactions:{userId}:{timestampMs}:{txRef} → Transaction object

deposits:pending:{currency}:{address} → Deposit object (status = pending)
deposits:confirmed:{txid}          → true  (dedup guard — key existence = already credited)

balance:{userId}                   → integer (micro-credits, stored as string)

chain:ltc:lastHeight               → integer (last processed LTC block height)
chain:xmr:lastHeight               → integer (last processed XMR block height)

pricing:gb_hour                    → integer (micro-credits per GB-hour)

meta:nextUserId                    → integer (auto-increment counter)
```

### Reading patterns

**Get one record**:
```js
const user = JSON.parse(await db.get(`users:${userId}`))
```

**Prefix scan** (e.g. all torrents for a user):
```js
const torrents = []
for await (const [, value] of db.iterator({
  gte: `torrents:${userId}:`,
  lte: `torrents:${userId}:~`,  // '~' sorts after all printable chars
})) {
  torrents.push(JSON.parse(value))
}
```

**Check key existence** (e.g. deposit dedup):
```js
// abstract-level v3: missing keys return undefined, they do NOT throw
const exists = (await db.get(`deposits:confirmed:${txid}`)) !== undefined
```

### Atomic writes — use batches

Any operation touching more than one key must use `db.batch()`. This is the LevelDB
equivalent of a transaction — all operations in a batch are written atomically.

```js
// Credit a deposit: update balance + write transaction + mark txid as confirmed
await db.batch([
  { type: 'put', key: `balance:${userId}`,               value: String(newBalance) },
  { type: 'put', key: `transactions:${userId}:${Date.now()}:${txid}`, value: JSON.stringify(tx) },
  { type: 'put', key: `deposits:confirmed:${txid}`,      value: 'true' },
  { type: 'del', key: `deposits:pending:${currency}:${address}` },
])
```

**Never write multiple keys with separate `db.put()` calls when atomicity matters.**
If the process crashes between two separate puts, the DB is left in an inconsistent state.

### No joins — denormalize deliberately

LevelDB has no joins. If a query needs data from two logical "tables", either:
1. Store a copy of the needed field on both objects (denormalize), or
2. Do two sequential `db.get()` calls in application code.

Example: storing `userId` on every torrent object means you never need a reverse scan
to find who owns a torrent — but also store `torrents:hash:{infoHash} → userId` as
an index key for the cases where you only have the hash (admin routes, chain poller).

---

## Architectural decisions

### 1. Crypto payment provider
**Current choice: self-hosted full nodes**

- **Litecoin**: Local `litecoind` with RPC enabled. Addresses via `getnewaddress`.
  Deposits detected by polling `listtransactions` keyed against `chain:ltc:lastHeight`.
- **Monero**: Local `monero-wallet-rpc`. Subaddresses via `create_address` per user.
  Deposits detected via `get_transfers` polling keyed against `chain:xmr:lastHeight`.

Both nodes are accessed through `src/chain/ltcNode.js` and `src/chain/xmrNode.js`.
Nothing outside `src/billing/deposits.js` calls chain modules directly.

Required interface for each chain module:
```js
generateAddress(userId)        → Promise<{ address, userId }>
getConfirmedDeposits(since)    → Promise<[{ address, amount, txid, confirmations }]>
getRequiredConfirmations()     → number   // LTC: 6, XMR: 10
```

### 2. Billing unit
**Current choice: GB-hours** — file size × active seeding time

```
gbHours = (torrent.sizeBytes / 1e9) * (intervalSeconds / 3600)
cost    = Math.ceil(gbHours * RATE_GB_HOUR)   // in micro-credits, ceiling favours service
```

The meter runs every 60 seconds. Paused torrents are skipped — no seeding, no charge.
`RATE_GB_HOUR` is read from `.env` and stored under `pricing:gb_hour` in LevelDB.

### 3. Balance zero behaviour
**Current choice: delete files after X days unpaid**

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
  → clear gracePeriodEndsAt + scheduledDeleteAt on user and torrents
  → resume all paused torrents
```

Files that have already been deleted cannot be recovered.
`GRACE_PERIOD_DAYS` and `DELETE_AFTER_DAYS` are set in `.env`.

---

## Directory structure

```
src/
  db/
    db.js                  # opens and exports the single LevelDB instance
    keys.js                # all key-builder functions — the only place key strings are constructed
    repositories/
      userRepo.js
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
      auth.js
      torrents.js
      files.js
      billing.js
      admin.js
    middleware/
      auth.js              # JWT → req.user
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

## `src/db/keys.js` — the single source of key strings

All LevelDB key strings are built in `keys.js`. No other file constructs key strings
by hand. This prevents typos causing silent misses and makes key changes a one-file edit.

```js
export const keys = {
  user:              (id)              => `users:${id}`,
  userByEmail:       (email)           => `users:email:${email}`,
  torrent:           (userId, hash)    => `torrents:${userId}:${hash}`,
  torrentByHash:     (hash)            => `torrents:hash:${hash}`,
  torrentsPrefix:    (userId)          => `torrents:${userId}:`,
  transaction:       (userId, ts, ref) => `transactions:${userId}:${ts}:${ref}`,
  txPrefix:          (userId)          => `transactions:${userId}:`,
  depositPending:    (currency, addr)  => `deposits:pending:${currency}:${addr}`,
  depositConfirmed:  (txid)            => `deposits:confirmed:${txid}`,
  balance:           (userId)          => `balance:${userId}`,
  chainHeight:       (chain)           => `chain:${chain}:lastHeight`,
  pricing:           (key)             => `pricing:${key}`,
  nextUserId:        ()                => `meta:nextUserId`,
}
```

---

## Environment variables

```
PORT=3000
DATA_DIR=./data
LEVEL_PATH=./data/db          # LevelDB directory

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
```

---

## Core rules — always follow these

### LevelDB

- One `db` instance for the entire process. Open it once in `src/db/db.js`, export it,
  import it everywhere. Never open a second instance pointing at the same path.
- Always use `keys.js` to build key strings. Never interpolate key strings inline.
- Always use `db.batch()` when writing more than one key atomically.
- Always `JSON.stringify` objects on write, `JSON.parse` on read. Store balances as
  plain numeric strings (not JSON) — `String(n)` on write, `Number(str)` on read.
- Missing keys: `db.get()` returns `undefined` (abstract-level v3 — does NOT throw).
  Always check `if (raw === undefined) return null` instead of try/catch LEVEL_NOT_FOUND.
- Prefix scans use `gte: prefix` and `lte: prefix + '~'`. The tilde `~` (ASCII 126)
  sorts after all printable characters, capping the range correctly.
- All repository methods are `async`. Never mix sync and async DB access.

### Auto-increment IDs

LevelDB has no auto-increment. Use this pattern in `userRepo.js`:

```js
export async function getNextUserId() {
  let current = 0
  try { current = Number(await db.get(keys.nextUserId())) } catch (_) {}
  const next = current + 1
  await db.put(keys.nextUserId(), String(next))
  return next
}
```

Call this inside a batch if the ID must be assigned atomically with the record write.

### WebTorrent client (`src/torrent/client.js`)

- One WebTorrent client instance for the entire process. Export the singleton.
- All API calls must match `webtorrent.md`. Do not guess method signatures.
- Attach event listeners inside `addTorrent()` immediately after metadata resolves.
- Paused torrents do not seed and do not accrue cost. Use `torrent.pause()` /
  `torrent.resume()` — never destroy and re-add to pause/resume.
- When permanently removing: call `torrent.destroy({ destroyStore: true })` then
  update `torrent.state = 'deleted'` in LevelDB via batch.
- On startup, `seeder.js` prefix-scans all `torrents:{userId}:{hash}` keys, filters
  for `state === 'active'`, and re-adds them before the HTTP server starts listening.

### File hosting flow (`POST /api/files/upload`)

1. Accept multipart file via `multer`, write to `DATA_DIR/tmp`.
2. Call `client.seed(tmpPath, { path: DATA_DIR/files })` — see `webtorrent.md`.
3. Wait for `infoHash` on the torrent object.
4. Write two keys atomically via batch:
   - `torrents:{userId}:{infoHash}` → torrent object (`state: 'active'`)
   - `torrents:hash:{infoHash}` → userId
5. Delete temp file.
6. Return `{ infoHash, magnetUri, name, sizeBytes }`.

### Credits and balance

- Balances are integers (micro-credits). 1 credit = 1000 micro-credits.
- Stored as plain numeric strings in LevelDB: `await db.put(keys.balance(userId), String(n))`.
- Read as: `Number(await db.get(keys.balance(userId)))`.
- All credit/debit operations use `db.batch()` to atomically update balance +
  write transaction record.
- Conversion in `src/billing/credits.js`:
  ```js
  const usd          = cryptoAmount * rates.getRate(currency)
  const microCredits = Math.floor(usd / CREDIT_USD_VALUE) * 1000
  ```
  Always `Math.floor` — never round in the user's favour.
- Clamp balance floor at `-50000` micro-credits to prevent runaway debt.

### Billing jobs (`src/jobs/`)

**`usageMeter.js`** — every 60 seconds:
```
prefix-scan torrents:{userId}: across all users
for each torrent where state === 'active':
  gbHours = (sizeBytes / 1e9) * (60 / 3600)
  cost    = Math.ceil(gbHours * RATE_GB_HOUR)
  batch:
    balance:{userId}  -= cost
    transactions:{userId}:{ts}:{ref} = debit record
skip torrents whose user balance is already <= 0
```

**`balanceEnforcer.js`** — every 60 seconds:

Step 1 — open grace period:
```
for each user where balance <= 0 AND gracePeriodEndsAt is null:
  set user.gracePeriodEndsAt = NOW + GRACE_PERIOD_DAYS * 86400000
  write updated user object
```

Step 2 — pause after grace expires:
```
for each user where gracePeriodEndsAt < NOW AND has active torrents:
  torrent.pause() each active torrent
  set torrent.state = 'paused'
  set torrent.scheduledDeleteAt = gracePeriodEndsAt + DELETE_AFTER_DAYS * 86400000
  write via batch
```

Step 3 — resume on top-up:
```
for each user where balance > 0 AND gracePeriodEndsAt is set:
  torrent.resume() each paused torrent
  set torrent.state = 'active', clear scheduledDeleteAt
  clear user.gracePeriodEndsAt
  write via batch
```

**`fileReaper.js`** — every 60 seconds:
```
prefix-scan all torrents
for each torrent where scheduledDeleteAt < NOW AND state !== 'deleted':
  torrent.destroy({ destroyStore: true })
  if torrent not in WebTorrent client: fs.rm(filePath, { recursive: true })
  batch:
    torrents:{userId}:{hash} → state: 'deleted', scheduledDeleteAt: null
  log: [reaper] deleted ${hash} for user ${userId}
```

This is the **only place** that deletes files from disk. Nowhere else.

### Deposit flow

1. `POST /api/billing/deposit` with `{ currency }` — validate against `ACCEPTED_CURRENCIES`.
2. Call chain module `generateAddress(userId)` → `address`.
3. Write `deposits:pending:{currency}:{address}` → deposit object.
4. Return address to user.
5. Chain poller detects confirmed deposit:
   - Check `deposits:confirmed:{txid}` — if exists, skip (already credited).
   - Convert amount to micro-credits via `credits.js`.
   - Batch: credit balance + write transaction + write `deposits:confirmed:{txid}` +
     delete `deposits:pending:{currency}:{address}`.
6. Update `chain:{chain}:lastHeight` after each poll.

### API conventions

- All responses: `{ success: boolean, data: any, error: string | null }`.
- Status codes: `200` ok, `201` created, `400` bad request, `401` unauthenticated,
  `402` balance depleted and grace expired, `403` forbidden, `404` not found, `500` server error.
- Middleware order: `authenticate` → `balance` → handler.
- Route handlers are thin. Logic lives in repositories and `src/billing/`.

### Auth

- Passwords: bcrypt, cost factor 12.
- JWT: HS256, `JWT_SECRET`, expiry `JWT_EXPIRY`. Stateless — no sessions.
- `req.user = { id, email, isAdmin }` after `authenticate`.
- Login: look up `users:email:{email}` → get userId → get `users:{userId}` → compare hash.

### Rate limiting

- Global: 100 req/min per IP.
- Auth routes: 10 req/min per IP.
- Deposit route: 5 req/min per user.

### Real-time progress (`GET /api/torrents/:hash/progress`)

SSE stream. Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`,
`Connection: keep-alive`.

Emit every 2 seconds:
```
data: {"progress":0.42,"uploadSpeed":51200,"numPeers":4,
       "balanceMicroCredits":12500,"gracePeriodEndsAt":null,"scheduledDeleteAt":null}\n\n
```

Keepalive every 15 seconds: `: keepalive\n\n`

Clean up on `req.on('close')`, torrent `done`, torrent `error`.

---

## What to do when unsure

1. Check `webtorrent.md` for any torrent or seeding question.
2. Check `src/db/keys.js` before constructing any key string.
3. If writing more than one key — use `db.batch()`. No exceptions.
4. Never call chain modules outside `src/billing/deposits.js`.
5. Never delete files from disk outside `src/jobs/fileReaper.js`.
6. If still unsure, stop and ask.

---

## Testing

- Mock `src/db/db.js` with an in-memory LevelDB (`{ location: undefined }` or
  `MemoryLevel` from `memory-level` package) in all tests.
- Mock `src/chain/ltcNode.js` and `src/chain/xmrNode.js` — no real node calls.
- Mock `src/billing/rates.js` — no real CoinGecko calls.
- Mock the WebTorrent client in job and route tests.
- The e2e suite covers: register → deposit (mocked) → upload file → poll progress →
  balance drains → grace period set → pause → scheduledDeleteAt set → top-up →
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
| 1 | Project scaffold & WebTorrent core | done |
| 2 | LevelDB setup — db.js, keys.js, repositories | done |
| 3 | REST API layer + file upload & seeding | done |
| 4 | Auth & balance middleware | done |
| 5 | Chain modules — LTC + XMR node clients & deposit poller | done |
| 6 | Credit conversion & deposit flow | done |
| 7 | Usage metering, balance enforcer & file reaper jobs | done |
| 8 | Real-time progress & hardening | done |

---

## Out of scope

- No browser/frontend — backend API only.
- No WebRTC — Node.js TCP/UDP only.
- No fiat payments, no Stripe, no third-party payment APIs.
- No multiple server instances — LevelDB is single-process only.
- No Docker or deployment config.
- No automatic node setup — `litecoind` and `monero-wallet-rpc` must be running
  before the service starts.