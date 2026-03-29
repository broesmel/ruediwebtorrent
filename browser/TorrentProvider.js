/**
 * TorrentProvider.js — browser-side ES module for ruediwebtorrent × decentral.ninja
 *
 * Drop-in path: es/components/controllers/TorrentProvider.js
 *
 * Usage:
 *   <torrent-provider data-api-url="https://torrent.decentral.ninja"></torrent-provider>
 *
 *   document.addEventListener('torrent-provider-ready', ({ detail }) => {
 *     const provider = detail.provider
 *     const { infoHash, magnetUri } = await provider.upload(file)
 *   })
 *
 * No dependencies, no build step required.
 */

const LS = {
  PUBKEY:  'torrent-provider:pubkey',
  PRIVKEY: 'torrent-provider:privkey',
  JWT:     'torrent-provider:jwt',
  JWT_EXP: 'torrent-provider:jwt-exp',
}

class TorrentProvider extends HTMLElement {
  #apiUrl = 'https://torrent.decentral.ninja'
  #publicKey  = null   // CryptoKey
  #privateKey = null   // CryptoKey
  #pubkeyHex  = null   // string

  // -------------------------------------------------------------------------
  // Web Component lifecycle
  // -------------------------------------------------------------------------

  static get observedAttributes() {
    return ['data-api-url']
  }

  attributeChangedCallback(name, _old, value) {
    if (name === 'data-api-url' && value) this.#apiUrl = value
  }

  async connectedCallback() {
    const apiAttr = this.getAttribute('data-api-url')
    if (apiAttr) this.#apiUrl = apiAttr
    try {
      await this.connect()
    } catch (err) {
      this.#dispatchError(err)
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Ensure keypair exists and JWT is valid. Called automatically on connect. */
  async connect() {
    await this.#loadOrGenerateKeypair()
    await this.#ensureAuth()
    this.#dispatch('torrent-provider-ready', { provider: this })
  }

  /**
   * Upload a File. Returns { infoHash, magnetUri, name, sizeBytes }.
   * Uses XHR so upload progress events fire correctly.
   */
  async upload(file) {
    const formData = new FormData()
    formData.append('file', file)

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${this.#apiUrl}/api/files/upload`)
      xhr.setRequestHeader('Authorization', `Bearer ${this.#getJwt()}`)

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          this.#dispatch('torrent-upload-progress', {
            loaded:  e.loaded,
            total:   e.total,
            percent: Math.round((e.loaded / e.total) * 100),
          })
        }
      })

      xhr.addEventListener('load', async () => {
        if (xhr.status === 401) {
          // Re-auth once and retry
          try {
            await this.#ensureAuth(true)
            const result = await this.upload(file)
            resolve(result)
          } catch (err) {
            reject(err)
          }
          return
        }

        let body
        try {
          body = JSON.parse(xhr.responseText)
        } catch {
          reject(new Error('Invalid server response'))
          return
        }

        if (!body.success) {
          reject(new Error(body.error ?? 'Upload failed'))
          return
        }

        const data = body.data
        this.#dispatch('torrent-uploaded', data)
        resolve(data)
      })

      xhr.addEventListener('error', () => reject(new Error('Network error during upload')))
      xhr.send(formData)
    })
  }

  /** Returns the current balance in micro-credits. */
  async getBalance() {
    const data = await this.#apiFetch('GET', '/api/billing/balance')
    this.#dispatch('torrent-balance', { microCredits: data.microCredits })
    return data.microCredits
  }

  /** Request a deposit address for 'ltc' or 'xmr'. */
  async requestDepositAddress(currency) {
    return this.#apiFetch('POST', '/api/billing/deposit', { currency })
  }

  /** List this user's torrents. */
  async listTorrents() {
    return this.#apiFetch('GET', '/api/torrents')
  }

  // -------------------------------------------------------------------------
  // Auth internals
  // -------------------------------------------------------------------------

  async #loadOrGenerateKeypair() {
    const storedPubkey  = localStorage.getItem(LS.PUBKEY)
    const storedPrivkey = localStorage.getItem(LS.PRIVKEY)

    if (storedPubkey && storedPrivkey) {
      // Re-import persisted keys
      try {
        const privkeyBytes = Uint8Array.from(atob(storedPrivkey), c => c.charCodeAt(0))
        this.#privateKey = await window.crypto.subtle.importKey(
          'pkcs8', privkeyBytes, { name: 'Ed25519' }, true, ['sign']
        )
        const pubkeyBytes = Uint8Array.from(storedPubkey.match(/.{2}/g).map(h => parseInt(h, 16)))
        this.#publicKey = await window.crypto.subtle.importKey(
          'raw', pubkeyBytes, { name: 'Ed25519' }, true, ['verify']
        )
        this.#pubkeyHex = storedPubkey
        return
      } catch {
        // Corrupt storage — fall through to regenerate
      }
    }

    // Generate fresh keypair
    const keyPair = await window.crypto.subtle.generateKey(
      { name: 'Ed25519' }, true, ['sign', 'verify']
    )
    this.#publicKey  = keyPair.publicKey
    this.#privateKey = keyPair.privateKey

    // Export and persist
    const pubkeyBytes  = new Uint8Array(await window.crypto.subtle.exportKey('raw', this.#publicKey))
    const privkeyBytes = new Uint8Array(await window.crypto.subtle.exportKey('pkcs8', this.#privateKey))

    this.#pubkeyHex = Array.from(pubkeyBytes).map(b => b.toString(16).padStart(2, '0')).join('')
    const privkeyB64 = btoa(String.fromCharCode(...privkeyBytes))

    localStorage.setItem(LS.PUBKEY,  this.#pubkeyHex)
    localStorage.setItem(LS.PRIVKEY, privkeyB64)
  }

  async #ensureAuth(forceRefresh = false) {
    if (!forceRefresh) {
      const jwt    = localStorage.getItem(LS.JWT)
      const jwtExp = Number(localStorage.getItem(LS.JWT_EXP) ?? 0)
      if (jwt && jwtExp > Date.now() + 30_000) return  // still valid with 30s margin
    }

    // Clear stale JWT
    localStorage.removeItem(LS.JWT)
    localStorage.removeItem(LS.JWT_EXP)

    // Challenge
    const challengeRes = await fetch(`${this.#apiUrl}/api/auth/challenge`)
    if (!challengeRes.ok) throw new Error(`Challenge failed: ${challengeRes.status}`)
    const { data: { nonce } } = await challengeRes.json()

    // Sign nonce
    const nonceBytes = new TextEncoder().encode(nonce)
    const sigBytes   = await window.crypto.subtle.sign('Ed25519', this.#privateKey, nonceBytes)
    const signature  = Array.from(new Uint8Array(sigBytes)).map(b => b.toString(16).padStart(2, '0')).join('')

    // Login
    const loginRes = await fetch(`${this.#apiUrl}/api/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ pubkey: this.#pubkeyHex, nonce, signature }),
    })

    if (!loginRes.ok) {
      const body = await loginRes.json().catch(() => ({}))
      throw new Error(body.error ?? `Login failed: ${loginRes.status}`)
    }

    const { data: { token } } = await loginRes.json()

    // Decode exp from JWT payload (middle segment, base64url)
    let exp = Date.now() + 7 * 24 * 60 * 60 * 1000
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      if (payload.exp) exp = payload.exp * 1000
    } catch {}

    localStorage.setItem(LS.JWT,     token)
    localStorage.setItem(LS.JWT_EXP, String(exp))
  }

  #getJwt() {
    return localStorage.getItem(LS.JWT) ?? ''
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  async #apiFetch(method, path, body) {
    const opts = {
      method,
      headers: {
        Authorization: `Bearer ${this.#getJwt()}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }

    let res = await fetch(`${this.#apiUrl}${path}`, opts)

    // Transparent re-auth on 401
    if (res.status === 401) {
      await this.#ensureAuth(true)
      opts.headers.Authorization = `Bearer ${this.#getJwt()}`
      res = await fetch(`${this.#apiUrl}${path}`, opts)
    }

    const json = await res.json()
    if (!json.success) throw new Error(json.error ?? 'Request failed')
    return json.data
  }

  #dispatch(type, detail) {
    document.dispatchEvent(new CustomEvent(type, { bubbles: false, detail }))
  }

  #dispatchError(error) {
    document.dispatchEvent(new CustomEvent('torrent-provider-error', {
      bubbles: false,
      detail: { error },
    }))
  }
}

customElements.define('torrent-provider', TorrentProvider)

export default TorrentProvider
