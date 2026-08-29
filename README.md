# Satoshi Scramble

**GRAB. BANK. ESCAPE.** — a 4–8 player realtime loot-and-bank arena for the
Hashplay/CoinUp arcade. Up to eight hunters share one arena for 90 seconds;
loot you carry is not safe until you sprint it to the bank; a giant cache
drops with 20 seconds left. Most banked wins — top 3 split the pot in **aBTC**,
settled by an Arch program. Standalone project (Game 2), independent of the
CoinUp/Arch Duel repo it learned from.

## Play

```bash
npm install && npm install --prefix server
GAME_DEV_FREEJOIN=1 npm run dev:server   # realtime server, ws://127.0.0.1:8890
npm run dev                              # http://localhost:5173
```

**PRACTICE MODE** plays instantly (local bots, no wallet, nothing at stake).
**LIVE** needs the server running and a Taproot Bitcoin wallet holding testnet
aBTC.

## Rules (SCRAMBLE_V1)

- Move with **WASD / arrows**. Loot → CARRYING; enter the **BANK** zone → it
  becomes BANKED (safe forever).
- Bump a richer hunter and **half their CARRYING spills on the floor** (banked
  is untouchable; 1.5s immunity after). No weapons — it's a scramble.
- Loot: small 10 / medium 25 / large 100 (game score, not money). One **large
  cache** spawns center at T-20s.
- Entry **0.0001 aBTC** each. 4+ players pay **70 / 20 / 10** to ranks 1-3;
  under 4, winner takes 100%. Fee 0%.

## Architecture

Client (Canvas 2D + prediction) ⇄ authoritative **20Hz WebSocket server**
(movement, collision, loot, banking, scores, canonical result) ⇄ **Arch
program** (aBTC escrow at join, rank payout at settlement, player refund
escape hatch). Not trustless — the server owns gameplay, the chain owns money;
a dead or hostile server can misrank a match at worst, never strand or inflate
funds. Full detail: `docs/ARCHITECTURE.md`, `docs/FAIRNESS.md`,
`docs/SECURITY.md`.

## Testnet & wallets

Arch **testnet** only (UI says so permanently). aBTC mint, RPC, program ID and
the verified integration table live in `docs/TESTNET.md`,
`docs/ASSET_MODEL.md`, `docs/ARCH_VERIFICATION.md`. Wallet support and test
status: `docs/WALLETS.md` (Arch Wallet extension human-verified; others
implemented, human test pending).

## Environment

Copy `.env.example`. Frontend vars are all public (`VITE_*`). The only secret
anywhere is the server's `SERVER_SIGNING_PRIVATE_KEY` (settlement attestation)
— server-side, never committed. There are no Arch API keys (endpoints are
keyless).

## Deploy

`docs/DEPLOYMENT.md` — frontend → Vercel (static), realtime server → Fly/
Railway (persistent WS), program → `scripts/deploy-and-init.sh`.

## Tests

```bash
npm test                                            # sim + result + bip322
npx tsx --test tests/multiplayer.test.mts           # 2-player WS match E2E
( cd programs/scramble && cargo test --features no-entrypoint --lib )   # payout math
SCRAMBLE_PROGRAM_ID=<hex> server/node_modules/.bin/tsx scripts/testnet-e2e.mts  # on-chain
```

## Status

Local game complete and tested (deterministic sim, 20Hz server, wallets,
escrow program). Live testnet deploy + on-chain settlement are scripted and
fire on faucet recovery — see `docs/CHANGELOG.md` for the current line.
