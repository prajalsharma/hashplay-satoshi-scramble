# SATOSHI SCRAMBLE — DISCOVERY REPORT

Date: 2026-08-29. Every external claim below is classified; "VERIFIED (live)"
means executed against real infrastructure during the 2026-08-28/29 audit
sessions, with the CoinUp/Arch Duel project as the working proof.

## 1. New repository location

Local: `~/hashplay-satoshi-scramble` (sibling of `~/coinup`; the machine has no
`~/Projects`, so the home-level sibling convention of the existing repos is
used). GitHub: `prajalsharma/hashplay-satoshi-scramble` (private, created).
Standalone: no imports from, or dependencies on, the coinup folder.

## 2. Existing CoinUp architecture learned from

Audited line-by-line (2026-08-28): modular `GameModule` registry; static-export
Next.js frontend; separate Node realtime service (`server/`) with a channel
pub/sub hub carrying monotonic `seq`, last-snapshot cache, and
auth→subscribe→snapshot/delta→resync over one WebSocket — the exact pattern a
realtime arena needs. Lesson kept: static frontend + one authoritative Node
service; chain as the only money authority.

## 3. Crazy Wheel lessons

Production Archade wheel (studied via live app + bundle recon): single focused
game page; full-screen HOW TO PLAY with house rules and one OK — GOT IT; wallet
modal (Arch Wallet / Xverse / Phantom / UniSat / Leather); explicit asset
labeling; instant replay; a dedicated realtime game server (Colyseus) behind a
Cocos client. The repo copy of the wheel is a localStorage mock — UX reference
only.

## 4. RPS lessons

Two generations: the PeerJS host-authoritative prototype (its trust model is
the anti-pattern: never let one client own state), and Arch Duel (built and
live 2026-08-28/29): commit-reveal, PDA escrow, terminal-status settlement
guards, timeout escape hatches, duel resume-after-refresh, preflighted actions
before wallet popups, plain-language errors. Satoshi Scramble must NOT be
another duel — it is a shared 4-8 player arena; what carries over is the
financial architecture, not the game shape.

## 5. Existing wallet integration

VERIFIED (live, real funds): the official **Arch Wallet extension**
(open-source: `Arch-Network/arch-wallet-hub` → `apps/chrome-wallet`) injects
`window.arch` with `connect()/getAccount()/signArchMessageHash(32-byte hash)`
returning a 64-byte Schnorr sig — user-proven end-to-end: it signed a real
1 aUSD escrow on testnet. Also implemented from verified sources: UniSat
(`signMessage(msg,'bip322-simple')` + witness parsing), Xverse
(`XverseProviders.BitcoinProvider`, BIP322 protocol), Phantom-Bitcoin, Leather
(`LeatherProvider`). Detection must retry on a backoff (extensions inject
late — an observed Xverse bug, fixed). Human-tested: Arch Wallet(+UniSat
signer). Untested by a human: direct Xverse/Phantom/Leather paths.

## 6. Existing Arch integration

VERIFIED (live): RPC `https://rpc.testnet.arch.network` (node 0.8.6);
`request_airdrop` funds any key (native gas); `get_program_accounts
[program_id, null]` works from the browser (powers a serverless
board/leaderboard); Explorer REST `https://explorer.arch.network/api/v1/testnet`
is **keyless** (accounts/{addr}/tokens returns full APL holdings with
metadata); tx status arrives as `"Processed"` string or `{Failed:"reason"}` /
`{type:"processed"}` — normalize once. **Corrections to this spec, with
evidence**: there is NO Explorer WebSocket (`wss://…/ws/testnet` refuses;
official arch-indexer repo is REST-only) and NO `ARCH_API_KEY` is needed for
any endpoint this game uses (all verified keyless). Realtime is the game
server's job. Programs: two escrow programs deployed to testnet from the
sibling project — native-asset (`BGKrUx4…`) and APL-token vault-as-PDA-ATA
(`8pxpD4…`, official-aUSD config, settled real user funds). Toolchain on this
machine: arch-cli 0.8.6 (testnet profile), Agave cargo-build-sbf 3.1.10, Rust
1.96, crates `arch_program`/`apl-token`/`apl-associated-token-account` 0.8.6.

## 7. Existing assets

CoinUp `public/images/`: Chip the Arcade Manager (pixel mascot, multi-size),
Jack the Dealer + card-room kit (Floor-2-specific — skip), brand book JPGs,
CRT shell CSS (`pixel-panel`/`pixel-btn`, scanline shell). Reuse candidates
(MIT-licensed repo): pixel-law styling rules, palette, fonts, Chip as arcade
host. All arena art (players, loot, tiles, vault, HUD) must be NEW —
docs/ASSET_INVENTORY.md at the docs step.

## 8. Existing brand system

CoinUp brand book (26 chapters, MIT repo): palette `#FCC76E` gold, `#FF5A00`
orange, `#2962FF` blue, `#FF4EC7` pink, `#00DE76` green on void `#000012`;
type Coinup Pixel / Press Start 2P / Inter; pixel law (1px=1hex, no AA/blur/
gradients on sprites, nearest-neighbor, 16/32/64/128). Satoshi Scramble adopts
the family with its own accent.

## 9. Current Arch capabilities verified

See §6. Additionally VERIFIED: full transaction pipeline from JS —
`SanitizedMessageUtil.createSanitizedMessage` → double-sha256-hex challenge →
BIP-322 taproot signing (local key or wallet) → `{version:0, signatures,
message}` → `send_transaction` → poll `get_processed_transaction`; APL token
CPI escrow (transfer in by player sig, out by match-PDA `invoke_signed`);
`get_clock().unix_timestamp` deadlines; PDA re-derivation guards; terminal
statuses as replay protection. Testnet fee ≈ 5,000 native units/tx.

## 10. Current wallet capabilities verified

§5. All wallets sign the same 64-char-hex challenge convention (the Arch
Wallet extension's `external-arch-message-hash.ts` confirms Xverse/UniSat
sign the hex *string*; Turnkey path identical). One shared `ArchSigner`
abstraction already exists as reference code (MIT, authored in the sibling
project) — will be re-implemented cleanly here.

## 11. Current testnet asset candidates

- **Official aBTC** ("Arch BTC") — APL token, mint
  `2yHWVNYyjnsxZqpnvTbPzWiHwpNQ2zBQU6BC4Lnbu7sW`
  (hex `1d46e0dd87393236e4e01252439f46dcbaec7c2255d1fd734e61771a00e8f4e9`),
  **8 decimals, 292 holders, live supply — VERIFIED via indexer 2026-08-29**.
- Official aUSD ("Arch USD") — mint `6mqUuwPY…` (hex `55c6ce…`), 6dp — VERIFIED.
- Native balance (airdrop-funded) — gas only.

## 12. aBTC verification

**VERIFIED — the spec's preferred asset is usable.** Identifier/decimals/
holders above; token program `TokenT4em53UrV4gSvZ3nCS2mZeHaqTLapwt6iZt6Mk`
(apl-token 0.8.6), ATA program `ATok9pxL…`; wallet display+signing proven for
APL tokens generally (user's Arch Wallet holds 1.0 aBTC and signed aUSD
transfers); program custody proven by the deployed vault-as-PDA-ATA escrow.
UNKNOWN: how new players acquire testnet aBTC (its faucet path — same
open question as aUSD; user-held funds and transfers work today).

## 13. Proposed multiplayer architecture

One authoritative Node/TS WebSocket server (this repo, `server/`): rooms of
4-8, fixed 20 Hz simulation tick, server-side movement/collision/loot/bank/
score, delta broadcasts (events + compact positional updates, never full
world every frame), per-message validation (identity, room, state, sequence,
rate), snapshot+resync on reconnect (pattern proven in CoinUp's hub). Client
predicts own movement, server reconciles. Colyseus (production Archade's
choice) noted as fallback if the custom server fights us — start simple per
spec §47.

## 14. Proposed gameplay

60-90s rounds, 4-8 players (MVP floor: 2 real players; below that the room
shows WAITING FOR HUNTERS — no fake players). Compact tile arena (~24×16)
with walls/chokepoints; loot: SMALL 10 / MEDIUM 25 / LARGE 100 (GameScore,
not money); one central high-value cache in the last 20s; carry vs banked
split; BANK zone converts carrying→banked; bump-tag: colliding with a
carrying player scatters half their carried loot (banked is safe) with 2s
immunity after — greed/fear/relief loop per spec §119. Keyboard WASD/arrows +
[SPACE/G] bank. Practice mode: clearly labeled, local bots, never on the real
leaderboard.

## 15. Proposed economic model (PROPOSAL — needs confirmation)

GameScore (bigint) strictly separate from AssetAmount (bigint, aBTC base
units). Entry: 10,000 base units = 0.0001 aBTC per player (≈ presets
0.0001/0.0005). Pot = N×entry, escrowed on-chain at join. Payout by final
rank: 70/20/10 to top 3 (2-3 players: winner-takes-all / 70-30), zero
protocol fee for MVP. Refunds: full, player-claimable on-chain, if the match
is cancelled or never settled within a timeout (coinflip H-3 escape-hatch
pattern). **Percentages are the spec's own proposal; confirm before program
freeze.**

## 16. On-chain/off-chain matrix

On-chain (program authority): entry escrow (room PDA's aBTC ATA), player
registry/capacity/dup-join guards, settlement (rank-based split computed
on-chain from stored entries), refund timeouts, single-settlement terminal
states. Server authority (documented, not trustless): movement, collision,
loot, banking, scores, timer, canonical result + rankings. Client:
rendering, prediction, input, sound. Indexer/RPC: read/confirm layer.

## 17. Security model

Program: PDA re-derivation, signer/owner checks, capacity and duplicate-join
rejection, settlement only by a pinned attestation authority (the game
server's key — an honest, documented trust boundary per spec §141/144, NOT
claimed trustless), payout amounts derived on-chain from escrowed entries
(never from the attestation), one-way terminal states, player-claimable
refund after deadline so a dead server can never strand funds. Server
anti-cheat: authoritative simulation; reject speed/teleport, out-of-range
pickup/bank, duplicate/out-of-order/over-rate messages. Secrets: only
`SERVER_SIGNING_PRIVATE_KEY` (settlement attestation) — server-side env, never
committed. No ARCH_API_KEY exists to leak.

## 18. Realtime architecture

Protocol (versioned, `SCRAMBLE_V1` in every match result): client→server
`join_room, ready, input(seq), bank_request, ping, reconnect(token)`;
server→client `room_state, player_joined/left, tick_delta, loot_spawn,
loot_collected, bank_result, leaderboard, countdown, match_start, match_end,
settlement_status`. Canonical result = deterministic field-ordered encoding →
SHA-256 `MATCH_RESULT_HASH`, embedded in the settlement instruction.

## 19. Required secrets

`SERVER_SIGNING_PRIVATE_KEY` (settlement authority; generated at deploy,
pinned into the program build like the proven `ARCH_DUEL_AUTHORITY` pattern).
Program deploy authority keypair (local file, gitignored). Nothing else — no
indexer/API keys (verified unnecessary).

## 20. Required dependencies

Frontend: Next.js (static export) or Vite (leaner for a single game — decide
at architecture step), `@arch-network/arch-sdk@0.0.28` (pin; 0.0.27 is a
broken publish — verified), `@scure/btc-signer` + `@noble/{curves,hashes}`
(BIP-322 signer, proven), Canvas 2D (no Three.js — spec §72 agrees). Server:
`ws`, `tsx`, TypeScript (Hono only if REST endpoints needed). Program:
`arch_program`/`apl-token`/`apl-associated-token-account` 0.8.6, borsh, sha2.

## 21. Open UNKNOWN items

(a) aBTC faucet path for new players — UNKNOWN; mitigations: user-to-user
transfers work, entry kept tiny. (b) Direct Xverse/Phantom/Leather signing —
implemented per docs, awaiting human test. (c) 8-player tick/broadcast
budget — needs the local load test (spec §89). (d) Realtime server hosting
(Fly/Railway) — deferred to deployment step. (e) Payout percentages —
awaiting product confirmation. (f) Whether room lifecycle needs
`start_match` on-chain or server-attested start inside settlement — decide at
program design.

## 22. Risks

Server is a real trust point (mitigated by on-chain refund escape hatch +
documented boundary); realtime fun is the hard part — the loop must be
playtested in practice mode before any chain wiring (implementation order
§158 enforces this); multi-wallet popups per join could feel heavy (one join
tx per match only — gameplay itself is off-chain); deploy-target drift
(arch-cli vs node versions — both already current on this machine).

## 23. Proposed file tree

```
hashplay-satoshi-scramble/
  package.json  README.md  .env.example  .gitignore
  src/
    app/ or index.html            # shell
    game/{arena,renderer,input,entities,scoring}/
    multiplayer/{client,protocol,interpolation}.ts
    arch/{config,rpc,txSend,bip322,signer,program,assets}.ts   # clean re-impl of proven lib
    components/{hud,leaderboard,lobby,wallet,result}/
  server/
    src/{rooms,simulation,protocol,anticheat,settlement,auth}/
    package.json
  programs/scramble/{Cargo.toml,src/lib.rs,examples/}
  public/{sprites,fonts,audio}/
  tests/  docs/  scripts/
```

## 24. Definition of Done

Spec §160 items 1-33 adopted verbatim as the acceptance list, with these
session-informed amendments: item 24's "indexer reflects settlement" is via
keyless Explorer REST + RPC readback (no WS exists); item 28 reads "the only
secret is the server signing key and deploy keys" (no API keys exist); wallet
claims (17/18) will list exactly what a human tested, Arch Wallet extension
first — it is the one already proven with real funds.
