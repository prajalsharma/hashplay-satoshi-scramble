# CONTEXT — read this before modifying anything

## What Satoshi Scramble is

A 4–8 player realtime loot-and-bank arena for the Hashplay/CoinUp arcade
(Game 2 of the planned 8). Players share one arena for ~90 seconds, collect
loot, and must return to the bank zone to secure it — carried loot can be
scattered by other players. Entry stakes are **official testnet aBTC** held in
on-chain escrow; final payout settles through an Arch program. Tagline:
GRAB. BANK. ESCAPE.

## Why it exists

Crazy Wheel = anticipation vs odds (live, community-tested). Arch Duel = 1v1
skill duel (built in the sibling repo, live on testnet). Scramble adds the
third psychology: shared-space competition — greed, fear, envy, last-second
banking — with real players visible to each other.

## Gameplay (SCRAMBLE_V1)

90s match, 3-2-1 countdown, 24×16-tile arena (32px tiles). Loot: SMALL 10 /
MEDIUM 25 / LARGE 100 GameScore. Bank zone converts CARRYING→BANKED
automatically on entry. Overlapping another player scatters 50% of the
higher-carrier's CARRYING as pickups (both get 1.5s immunity); BANKED is
never lost. At T-20s a LARGE cache spawns center-arena. Rooms start with
2–8 real players (30s fill window; below 2 → WAITING FOR HUNTERS). Practice
mode is local, labeled, bots allowed, never on the real leaderboard.

## Architecture (one line each)

- Frontend: static web client, Canvas 2D arena + DOM HUD.
- Realtime: authoritative Node WS server in `server/` (20Hz tick, delta
  broadcasts, full anti-cheat validation).
- Money: Arch program in `programs/scramble/` — aBTC escrow at join,
  rank-based payout at settlement, player-claimable refunds on timeout.
- Discovery/status: keyless Arch RPC + Explorer REST (no API keys exist).

## Wallets

`ArchSigner` abstraction: Arch Wallet extension (`window.arch`,
`signArchMessageHash` — human-proven in the sibling project with real funds),
UniSat (bip322-simple), Xverse (BIP322 protocol), Phantom-Bitcoin, Leather.
All sign the same 64-char-hex sanitized-message challenge. Detection retries
on a backoff (extensions inject late).

## Chosen asset

Official testnet aBTC ("Arch BTC"), APL token, 8 decimals, mint
`2yHWVNYyjnsxZqpnvTbPzWiHwpNQ2zBQU6BC4Lnbu7sW`
(hex `1d46e0dd87393236e4e01252439f46dcbaec7c2255d1fd734e61771a00e8f4e9`).
Native balance (airdrop) pays gas only. GameScore and AssetAmount are
separate bigint types — never mixed.

## Testnet configuration

RPC `https://rpc.testnet.arch.network` · Indexer
`https://explorer.arch.network/api/v1/testnet` (keyless; NO WebSocket exists)
· arch-cli 0.8.6 testnet profile on the dev machine · program ID: not yet
deployed (see CHANGELOG when it lands).

## Economic rules (working defaults — confirm before program freeze)

Entry 10,000 base units (0.0001 aBTC)/player · pot = N×entry · payout
70/20/10 to ranks 1-3 (winner-takes-all at N=2-3) · no protocol fee · full
refund claimable by each player if the match is unsettled past its deadline.

## Security assumptions

Server-authoritative gameplay with a pinned server attestation key for
settlement — honest trust boundary, NOT trustless (see FAIRNESS.md). Program
enforces everything money-related; refund escape hatch guarantees a dead or
hostile server cannot strand funds.

## Known limitations / pending work

aBTC faucet path for new players UNKNOWN; Xverse/Phantom/Leather signing
implemented but not human-tested; 8-player load test pending; realtime
server hosting undecided (Fly/Railway candidates). Implementation has not
started — gated order in the spec (§158) applies.

## Rejected approaches

See DECISIONS.md. Highlights: no PeerJS/client-host authority (the old RPS
trust hole), no Colyseus (custom server first), no Three.js, no fake players,
no per-frame world broadcasts, no on-chain movement.

## Important files

`docs/DISCOVERY.md` (evidence base) · `docs/ARCH_VERIFICATION.md` (dated
verification table) · sibling prior art: `~/coinup` (MIT) — reference only,
never a dependency.

## Implementation status (2026-08-29, release candidate)

COMPLETE (local): shared deterministic sim, Canvas renderer, 20Hz
authoritative WS server, practice mode, ArchSigner (5 wallets), tx pipeline,
BIP-322 sign+verify, escrow program (init/create/join/settle/reclaim, exact
70/20/10, refund hatch), preflight/deploy/e2e scripts.

VERIFIED (local, automated): sim/result/bip322 unit tests (11); Rust payout
math (2); 2-player WS match to result-hash agreement; **4- and 8-player**
matches over the real protocol — everyone visible, all agree on the result
hash, stable ~20Hz (116 ticks/~6s), server idle ~88MB; disconnect mid-match
does not corrupt or duplicate; canonical hash deterministic + tamper-evident.
Frontend+server typecheck clean; Vite build 93KB gz; preflight fail-fasts
correctly.

IMPLEMENTED — HUMAN TEST REQUIRED: UniSat/Xverse/Phantom/Leather signing
(Arch Wallet extension already human-verified in the sibling project).

BLOCKED — EXTERNAL (testnet faucet outage): program deploy, init_config,
on-chain E2E, real-wallet + real-player settlement. All scripted; run
`docs/GO_LIVE_TESTNET.md` when funded. Program will deploy to
`4cf17458cef8a3bc18bbcf052ac13ad7be5e68a99996c565bcc46a7bcc0a10d8`
(base58 6BMXfCSXFEeYT6Zmg39uZXnDKBWZNv5cPm7aYZnBBLZV).
