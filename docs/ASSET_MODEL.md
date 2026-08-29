# ASSET MODEL

Asset name: **Arch BTC (aBTC)** — the official Arch testnet BTC token.
Network: Arch testnet.
Identifier: mint `2yHWVNYyjnsxZqpnvTbPzWiHwpNQ2zBQU6BC4Lnbu7sW`
  (hex `1d46e0dd87393236e4e01252439f46dcbaec7c2255d1fd734e61771a00e8f4e9`).
Decimals: **8** (1 aBTC = 100,000,000 base units).
Token program: APL `TokenT4em53UrV4gSvZ3nCS2mZeHaqTLapwt6iZt6Mk`
  (crate `apl-token 0.8.6` — SPL-compatible instruction set).
ATA requirements: associated token accounts via
  `ATok9pxLsNzM5zJJ3UQpXBrMriHpZiY5Yio3GKYU4we3`
  (`apl-associated-token-account 0.8.6`); idempotent create (data `[1]`)
  prepended client-side; the escrow vault is the Match PDA's ATA (off-curve
  owner allowed — VERIFIED pattern).
Wallet compatibility: displayed and held by the official Arch Wallet
  extension (user's wallet holds 1.00000000 aBTC — observed via indexer);
  indexer serves name/symbol metadata for all wallets' UIs.
Transfer path: APL `Transfer` (tag 3) — player-signed into the vault at
  join; vault→player via Match-PDA `invoke_signed` at settlement/refund.
Program compatibility: identical to the vault-as-PDA-ATA escrow VERIFIED
  end-to-end with the official aUSD token in the sibling project
  (real user funds escrowed and settled on 2026-08-28).
Source: live Arch Explorer indexer
  (`/api/v1/testnet/tokens/{mint}`, `/accounts/{addr}/tokens`) + apl-token
  crate source + working sibling deployment.
Verification date: **2026-08-29** (mint metadata: 8 decimals, 292 holders,
  supply 779,256,907,117,893 base units).

Related, for context only:
- Official aUSD ("Arch USD") `6mqUuwPY…` / hex `55c6ce…`, 6dp — VERIFIED;
  the sibling game stakes it.
- Native testnet balance (airdrop-funded, sats-scale) — gas only, never the
  stake asset here.

UNKNOWN — REQUIRES VERIFICATION: the public acquisition path for testnet
aBTC (Arch's faucet is behind their key-gated Wallet Hub). Mitigations:
holders can transfer freely (verified transfer path); entry kept tiny
(10,000 base units = 0.0001 aBTC). Resolve before public playtests.

Money typing rule (enforced in code): `type AssetAmount = bigint` (aBTC base
units) and `type GameScore = bigint` are distinct branded types; no implicit
conversion; no floating point anywhere near either.
