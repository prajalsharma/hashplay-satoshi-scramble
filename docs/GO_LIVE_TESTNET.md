# GO LIVE — TESTNET RECOVERY GUIDE

Everything below is blocked ONLY by testnet funding. When the Arch faucet is
back (or you fund the deploy authority by transfer), run this exact sequence
from the repo root. Nothing here touches mainnet.

## 0. Prerequisites (already in the repo)
- `programs/scramble/.deploy-authority.json` — the pinned config+settlement key
  (gitignored raw secret). Its pubkey is baked into the SBF build.
- arch-cli 0.8.6 testnet profile + Agave cargo-build-sbf on PATH.

## 1. Fund the deploy authority
The faucet funds it automatically inside step 3. To fund by transfer instead,
its address is printed by:
```bash
npm run testnet:preflight        # shows the authority pubkey + funded status
```

## 2. Preflight (fail-fast)
```bash
npm run testnet:preflight
```
Green on network/RPC/asset; it will flag the program+config+funding as missing
until the next steps run. If the authority shows funded, continue.

## 3. Deploy + build
```bash
npm run testnet:deploy           # scripts/deploy-and-init.sh
# builds SBF (authority pinned), waits for the faucet, deploys.
# writes the program id to .scramble-program-id
export SCRAMBLE_PROGRAM_ID=$(cat .scramble-program-id)
```
Idempotent: re-running skips deploy if the ELF is unchanged. The program keypair
is fixed (`programs/scramble/target/deploy/scramble-keypair.json`) so re-runs
target the SAME program id — no accidental second program.

## 4. Initialize config + on-chain E2E
```bash
SCRAMBLE_PROGRAM_ID=$SCRAMBLE_PROGRAM_ID npm run testnet:e2e
```
This runs the full financial path AND the guard tests:
init_config (skips if already initialized) → fund 4 players → create_match →
4 real aBTC escrow joins → duplicate-join rejected → settle_match → assert
EXACT 70/20/10 payouts + empty vault + SETTLED → double-settle rejected →
reclaim-after-settle rejected. Prints PASS only if all hold on-chain.

## 5. Point the apps at the deployed program
Frontend env: `VITE_SCRAMBLE_PROGRAM_ID=$SCRAMBLE_PROGRAM_ID`.
Server env: `SCRAMBLE_PROGRAM_ID=$SCRAMBLE_PROGRAM_ID` +
`SERVER_SIGNING_PRIVATE_KEY=<64-hex of the deploy authority secret>`
(so the running server IS the settlement authority the config pinned).

## 6. Real wallet test (human)
Open the deployed frontend, CONNECT WALLET (Arch Wallet / UniSat / Xverse),
confirm: connected · address · ARCH TESTNET · aBTC balance. Join a room → PAY
ENTRY → observe PREPARING→SIGNING→CONFIRMED. Record the result in
`docs/WALLETS.md` (change status from IMPLEMENTED — HUMAN TEST REQUIRED to
VERIFIED for whichever wallet you used).

## 7. Real two-player match (two browsers)
Browser A (wallet 1) + Browser B (wallet 2), both holding aBTC → same room →
both pay entry → play → match ends → SETTLEMENT CONFIRMED with a tx id →
inspect the tx and both wallet balances → refresh a browser and confirm the
result persists.

## 8. Four-player match
Four wallets/browsers → one room → verify the 70/20/10 split hit the right
three wallets on-chain.

## 9. Verify + document
- Settlement tx on the explorer; vault emptied; payouts exact.
- Replay protection: a second settle of the same match fails.
- Update `docs/CHANGELOG.md` and `docs/CONTEXT.md` with the program id,
  deploy tx, and test outcomes. Flip the relevant statuses from
  BLOCKED/HUMAN-TEST to VERIFIED.

## One-liner once funded
```bash
npm run testnet:preflight && npm run testnet:deploy && \
  SCRAMBLE_PROGRAM_ID=$(cat .scramble-program-id) npm run testnet:e2e
```
