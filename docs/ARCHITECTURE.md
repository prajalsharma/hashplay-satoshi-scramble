# ARCHITECTURE

```
PLAYER
  │ keyboard input · wallet approvals
  ▼
WALLET (Arch Wallet ext / UniSat / Xverse / Phantom-BTC / Leather)
  │ BIP-322 signature over the sanitized-message hash
  ▼
CLIENT (static web app)
  ├── game/        Canvas 2D arena, prediction+interpolation, HUD (DOM)
  ├── multiplayer/ WS client, protocol codec, reconnect w/ resume token
  └── arch/        signer, tx build/send, RPC+indexer reads (all keyless)
  │                                    │
  │ WS (inputs/deltas)                 │ one join tx · reads
  ▼                                    ▼
REALTIME GAME SERVER (server/, Node+ws)          ARCH TESTNET
  rooms · 20Hz simulation · anti-cheat            program: escrow/settle/refund
  canonical result + SHA-256 hash                 aBTC APL token (8dp)
  │ settlement tx signed by pinned                RPC rpc.testnet.arch.network
  │ SERVER_SIGNING key                            Indexer explorer.../api/v1/testnet
  └────────────────────────────────────────────────────────┘
```

## Components

**Client** — no framework lock-in decided yet beyond: static hosting, Canvas
2D arena, DOM for lobby/HUD/wallet/result. State split: simulation snapshot
(from server), predicted self, UI state — never one giant component.

**Realtime server** (`server/`) — authoritative for everything gameplay:
rooms/matchmaking (public rooms 01-03), 20Hz fixed tick, movement integration
+ collision, loot spawn/pickup, scatter, banking, timer, scores,
leaderboard, canonical result. Holds `SERVER_SIGNING_PRIVATE_KEY` (the only
secret) to sign settlements. Structure: `rooms/ simulation/ protocol/
anticheat/ settlement/ auth/`.

**Arch program** (`programs/scramble/`, arch_program 0.8.6) — smallest set:

- Accounts: `Config` PDA ["config"] (deploy-pinned init authority, settlement
  authority pubkey, aBTC mint, entry bounds, join/settle timeouts) ·
  `Match` PDA ["match", server_authority, match_id] (entry, max_players,
  players[8], joined count, state, deadlines, result_hash, bump) · vault =
  match PDA's aBTC ATA (proven vault-as-PDA-ATA pattern).
- Instructions (conceptual, frozen at program gate): `init_config`,
  `create_match` (server authority), `join_match` (player signs; transfers
  entry to vault; capacity/duplicate/deadline checks), `settle_match`
  (settlement authority signs; provides ranked player list + result hash;
  program pays 70/20/10 from escrowed total, marks terminal),
  `reclaim_entry` (any joined player, after settle-deadline, if unsettled —
  full entry back; per-player claimed flags).
- Guards: PDA re-derivation, owner/signer checks, terminal one-way states,
  payouts computed on-chain from stored entries (never from attestation),
  per-player refund flags versus double-claims.

## Realtime protocol (v1)

Client→server: `hello{token} · join_room{room} · ready · input{seq,dirs} ·
ping · resume{resumeToken}`. Server→client: `welcome{playerId,resumeToken} ·
room_state · countdown{n} · tick{seq, moved:[id,x,y,vx,vy], events:[...]} ·
loot_spawn/loot_collected/scatter/bank_result · leaderboard ·
match_start/match_end{result} · settlement_status{state,txid?}`. Deltas only;
full snapshot on join/resume. Every message validated: identity, room
membership, allowed state, seq monotonicity, rate (≤30 inputs/s, ≤2
non-input/s).

## Canonical result

Deterministic byte encoding (fixed field order, u64-LE, no JSON):
`"SCRAMBLE_V1" ‖ match_id ‖ entry ‖ n ‖ [player_pubkey ‖ banked]×n ‖
rankings ‖ start_ts ‖ end_ts` → SHA-256 = MATCH_RESULT_HASH, stored on-chain
at settlement, logged, shown in the debug panel.

## Environments

LOCAL (practice, local server, no chain) · TESTNET (real everything). Config
via env only: `ARCH_RPC_URL, ARCH_INDEXER_URL, SCRAMBLE_PROGRAM_ID,
SCRAMBLE_ASSET_MINT, GAME_WS_URL, GAME_ENV, SERVER_SIGNING_PRIVATE_KEY
(server-only)`. No URLs in components. Mainnet: not wired anywhere; UI
permanently shows ARCH TESTNET this phase.

## Deployment (later gate)

Client → Vercel (static). Realtime server → Fly/Railway (Node + WS).
Program → arch-cli 0.8.6 testnet profile (`cargo build-sbf` → deploy →
init_config; authority keys stay local/host secrets).

## Learned-from vs new

Learned (re-implemented, MIT prior art in ~/coinup): BIP-322 signer +
tx pipeline, ArchSigner wallet roster, vault-as-PDA-ATA escrow, terminal
settlement guards, refund hatch, seq/snapshot/resync WS pattern, keyless
indexer/`get_program_accounts` reads. New: the whole arena game, the
authoritative simulation, multi-player escrow/rank-payout program, canonical
result attestation flow.
