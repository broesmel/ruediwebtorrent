# ruediwebtorrent

A Node.js WebTorrent seedbox and billing service for [decentral.ninja](https://decentral.ninja).
Users seed files via this service and pay with cryptocurrency (LTC, XMR) on a pay-per-GB-hour basis.

---

## Auth model — Ed25519 keypair challenge-response

There are no passwords or email addresses. Identity is a locally-generated Ed25519 keypair stored in `localStorage` by `TorrentProvider.js`.

**Flow:**

```
1. GET  /api/auth/challenge
   ← { nonce: "<64-char hex>", expiresAt: <ms> }

2. Browser signs nonce with Ed25519 private key (SubtleCrypto)
   POST /api/auth/login  { pubkey, nonce, signature }
   ← { token: "<JWT>", user: { id, isAdmin } }

3. JWT sent as Bearer token on all subsequent requests
```

Nonces are one-time use and expire after 60 seconds. `userId` is `sha256(pubkeyHex)`.

---

## TorrentProvider.js integration

`browser/TorrentProvider.js` is a self-contained ES module / Web Component for decentral.ninja.
Drop it at `es/components/controllers/TorrentProvider.js` in the chat submodule.

```html
<torrent-provider data-api-url="https://torrent.decentral.ninja"></torrent-provider>
<script type="module" src="es/components/controllers/TorrentProvider.js"></script>
```

```js
document.addEventListener('torrent-provider-ready', async ({ detail }) => {
  const provider = detail.provider

  // Upload a file
  const { magnetUri } = await provider.upload(file)

  // Track upload progress
  document.addEventListener('torrent-upload-progress', ({ detail }) => {
    console.log(`${detail.percent}%`)
  })

  // Balance
  const microCredits = await provider.getBalance()

  // Deposit
  const { address } = await provider.requestDepositAddress('ltc')
})
```

**Events dispatched on `document`:**

| Event | Detail |
|---|---|
| `torrent-provider-ready` | `{ provider }` |
| `torrent-provider-error` | `{ error }` |
| `torrent-uploaded` | `{ infoHash, magnetUri, name, sizeBytes }` |
| `torrent-upload-progress` | `{ loaded, total, percent }` |
| `torrent-balance` | `{ microCredits }` |

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
CREDIT_USD_VALUE=0.001
RATE_GB_HOUR=5

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

# File upload size limit (MB)
MAX_FILE_SIZE_MB=500
```

---

## npm scripts

```
npm start        # start the server
npm run dev      # nodemon watch
npm test         # run all tests
npm run db:seed  # write default pricing keys to LevelDB
```
