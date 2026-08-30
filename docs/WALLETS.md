# WALLETS

All wallets sign the same challenge: the sanitized-message hash as a 64-char
lowercase hex string (BIP-322 over a Taproot key) — the convention VERIFIED
end-to-end against Arch testnet in the sibling project. One `ArchSigner`
abstraction: `{kind, label, publicKey (x-only 32B), address?, sign(challenge)}`
+ `detectWallets()` (retried on 0.4s/1.2s/3s backoff AND on modal open —
extensions inject late; an observed Xverse race) + `disconnectWallet()`.

| Wallet | Detect | Connect | Sign | Status |
|---|---|---|---|---|
| **Arch Wallet** (official extension) | `window.arch.isArchWallet` (fallback `window.bitcoinArch`) | `arch.connect()` → `{address, publicKey, archAddress}`; Arch pubkey = base58-decoded `archAddress` | `arch.signArchMessageHash(raw 32B)` → `{signature64Hex}` (extension re-hexes and BIP-322-signs — its source confirms the string convention) | **VERIFIED — human test with real funds, 2026-08-28** (signed a real token escrow; note: it may route approval through a linked external signer like UniSat — that is its design) |
| UniSat | `window.unisat` | `requestAccounts()` (must be Taproot `tb1p…`) + `getPublicKey()` → x-only (drop 02/03 prefix, no tweak) | `signMessage(hexStr,'bip322-simple')` → base64 witness → parse stack → 64B (65B: strip trailing sighash; 66B: strip 2-byte prefix; 2-item stack = not Taproot → clear error) | Implemented from verified sources; direct human test pending (proven indirectly as Arch Wallet's linked signer) |
| Xverse | `window.XverseProviders.BitcoinProvider` (or `window.BitcoinProvider`) | `request('getAccounts',{purposes:['ordinals','payment']})` → ordinals/Taproot account + publicKey | `request('signMessage',{address,message,protocol:'BIP322'})` → same witness extraction | Implemented; **UNKNOWN — human test required** before claiming support |
| Phantom (Bitcoin provider) | `window.phantom.bitcoin.isPhantom` | `requestAccounts()` → p2tr account | `signMessage(address, utf8Bytes)` → extract 64B | Implemented; human test pending |
| Leather | `window.LeatherProvider` | `request('getAddresses')` → p2tr entry | `request('signMessage',{message,paymentType:'p2tr'})` → base64 → extract | Implemented; human test pending |

Errors shown to players (never raw): wallet missing → INSTALL <WALLET>;
non-Taproot account → "SWITCH TO A TAPROOT (P2TR) ADDRESS"; rejection →
"SIGNATURE DECLINED — YOUR FUNDS ARE UNTOUCHED"; wrong network → SWITCH
NETWORK. Connect flow: nothing connects uninvited; explicit CONNECT WALLET →
modal (Arch Wallet on top with INSTALLED/NOT DETECTED badges, then the
roster); persisted choice; LOG OUT calls provider disconnect where supported.

Session auth signs a READABLE login message (SIWE-style), NEVER a raw hash — a login signature can never be replayed as a transaction (docs/SECURITY.md, tests/security.test.ts).

Test log (to be appended as each human test happens): 2026-08-28 — Arch
Wallet on Brave/macOS, testnet, official aUSD: connect ✓ sign ✓ submit ✓
escrow ✓ (sibling project, user-executed).

## The "Arch Wallet · Connect" relay popup (verified from wallet source 2026-08-30)

This window is the Arch Wallet **extension's external-wallet bridge** popup — a
script-less HTML page (`wallet-hub-api /v1/extension/connect`) opened/closed
ONLY by the extension's background worker. **The dApp cannot close it** — no
handshake, ack, or promise. It appears ONLY when the connected Arch Wallet
account is a **linked external wallet (UniSat/Xverse)** and the extension relays
to it; a Turnkey/passkey/email account signs in-extension and never opens it. It
closes via the extension's `CLOSE_EXTERNAL_CONNECTOR` message (sent only from the
extension's Onboarding flow) or a **90s idle timer**; the extension's dApp-sign
path never sends that message, so it can linger up to ~90s (extension bug, not
ours). Provider API (`window.arch` / `window.bitcoinArch`): promise-based
`connect()` → `{address, publicKey, archAddress}`, and **`getAccount()` returns
an already-connected account WITHOUT opening any popup** (per-origin, consent-
gated). dApp mitigations we ship: `getAccount()` pre-check before `connect()`,
`silentArch()` restore on load (no popup on reload), single-connect in-flight
guard, a long (180s) safety-net timeout (never abandon early), and steering users
to **UniSat/Xverse (inline signing, no relay popup)** — the definitive escape
since a linked account is the same key/account anyway.
