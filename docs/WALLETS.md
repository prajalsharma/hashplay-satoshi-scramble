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
