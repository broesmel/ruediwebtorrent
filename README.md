# ruediwebtorrent

WebTorrent seedbox and file hosting service for [decentral.ninja](https://decentral.ninja).

---

## What it is

A Node.js service that lets users of decentral.ninja store and seed files via WebTorrent.
Users authenticate with a locally-generated Ed25519 keypair — no email, no password, no accounts.
Files are billed by GB-hour and paid with cryptocurrency (LTC or XMR).

---

## API docs

Start the server and open `http://localhost:3000/api/docs` for the full interactive Scalar UI.

---

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+, ESM |
| HTTP | Express 5 |
| Torrents | WebTorrent |
| Database | LevelDB (`classic-level`) |
| Auth | Ed25519 challenge-response, JWT |
| Crypto payments | Litecoin (`litecoind`) + Monero (`monero-wallet-rpc`) |
| Real-time | Server-Sent Events (SSE) |

---

## Auth model

Each user generates a dedicated Ed25519 keypair in the browser (via `TorrentProvider.js`).
The public key is the stable identity — `userId = sha256(pubkeyHex)`.

**Flow:**
1. `GET /api/auth/challenge` → receive a 32-byte nonce (60s TTL)
2. Sign the nonce with your Ed25519 private key
3. `POST /api/auth/login { pubkey, nonce, signature }` → receive a JWT

First login auto-registers the user. There is no separate registration step.
Losing your keypair means losing access to your balance — same as losing a crypto wallet.

See `AGENT.md` for full auth specification.

---

## Quick start

```bash
git clone <repo-url>
cd ruediwebtorrent
cp .env.example .env
# edit .env — set JWT_SECRET, LTC/XMR RPC credentials, CORS_ORIGIN
npm install
npm run db:seed
npm start
```

---

## Prerequisites

- **Litecoin node**: `litecoind` must be running and accessible via RPC before starting.
  See the [Litecoin documentation](https://litecoin.org).
- **Monero wallet RPC**: `monero-wallet-rpc` must be running before starting.
  See the [Monero documentation](https://getmonero.org).

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `DATA_DIR` | `./data` | Root directory for uploaded files and LevelDB |
| `LEVEL_PATH` | `./data/db` | LevelDB directory |
| `JWT_SECRET` | — | JWT signing secret — **minimum 32 characters, required** |
| `JWT_EXPIRY` | `7d` | JWT expiry (jsonwebtoken format) |
| `CREDIT_USD_VALUE` | `0.001` | USD value of 1 micro-credit |
| `RATE_GB_HOUR` | `5` | Micro-credits charged per GB-hour |
| `GRACE_PERIOD_DAYS` | `3` | Days before torrents are paused after balance hits 0 |
| `DELETE_AFTER_DAYS` | `7` | Days after pause before files are permanently deleted |
| `LTC_RPC_HOST` | `127.0.0.1` | Litecoin RPC host |
| `LTC_RPC_PORT` | `9332` | Litecoin RPC port |
| `LTC_RPC_USER` | — | Litecoin RPC username |
| `LTC_RPC_PASS` | — | Litecoin RPC password |
| `LTC_CONFIRMATIONS` | `6` | Required confirmations for LTC deposits |
| `XMR_RPC_HOST` | `127.0.0.1` | Monero wallet RPC host |
| `XMR_RPC_PORT` | `18083` | Monero wallet RPC port |
| `XMR_CONFIRMATIONS` | `10` | Required confirmations for XMR deposits |
| `XMR_WALLET_ACCOUNT` | `0` | Monero wallet account index |
| `CHAIN_POLL_INTERVAL_MS` | `60000` | Interval between deposit polls (ms) |
| `ACCEPTED_CURRENCIES` | `ltc,xmr,btc,doge,zec` | Comma-separated list of accepted currencies |
| `CORS_ORIGIN` | `https://decentral.ninja` | Allowed CORS origin |
| `MAX_FILE_SIZE_MB` | `500` | Maximum upload file size in MB |

---

## Billing

Storage is billed in micro-credits per GB-hour. When a user's balance reaches zero, a
3-day grace period begins — torrents continue seeding. After the grace period expires,
torrents are paused and scheduled for deletion 7 days later. Topping up at any point
before deletion resumes all torrents and clears the deletion schedule.
Files deleted by the reaper cannot be recovered.

---

## Browser integration

`browser/TorrentProvider.js` is a self-contained ES module and Web Component for decentral.ninja.
Drop it at `es/components/controllers/TorrentProvider.js` in the chat submodule.

```html
<torrent-provider data-api-url="https://torrent.decentral.ninja"></torrent-provider>
<script type="module" src="es/components/controllers/TorrentProvider.js"></script>
```

```js
document.addEventListener('torrent-provider-ready', async ({ detail }) => {
  const provider = detail.provider
  const { magnetUri } = await provider.upload(file)
})
```

**Events dispatched on `document`:**

| Event | Detail |
|---|---|
| `torrent-provider-ready` | `{ provider }` — authed and ready |
| `torrent-provider-error` | `{ error }` — auth or network failure |
| `torrent-uploaded` | `{ infoHash, magnetUri, name, sizeBytes }` |
| `torrent-upload-progress` | `{ loaded, total, percent }` |
| `torrent-balance` | `{ microCredits }` |

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
| 9 | decentral.ninja integration — keypair auth | ✅ done |
| 10 | decentral.ninja integration — TorrentProvider browser module | ✅ done |
| 11 | CORS, rate limiting & production hardening | ✅ done |
| 12 | OpenAPI spec, Scalar UI & README | ✅ done |

---

## npm scripts

```
npm start        # start the server
npm run dev      # nodemon watch
npm test         # run all tests
npm run db:seed  # write default pricing keys to LevelDB
```

---

## License

MIT
