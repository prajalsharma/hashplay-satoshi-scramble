# DESIGN — SCRAMBLE_V1 gameplay specification

Every number here is the tunable-but-authoritative default. Changing any of
them is a ruleset change: bump `RULESET_VERSION` and log in CHANGELOG.md.

## Arena

24×16 tiles, 32px each (768×512 canvas). Layout: outer wall ring; 4 interior
wall clusters forming two chokepoints and one safe corridor; BANK zone = 2×2
tiles bottom-center; players spawn at 8 fixed pads along the edges (shuffled
per match). No giant open field: median loot-to-bank run ≈ 3-5 seconds.

## Movement

8-directional (WASD/arrows; diagonals normalized). Max speed 4.5 tiles/s,
accel 25 tiles/s², friction 18 tiles/s². Circle collider r=0.35 tile vs
walls and players. Server simulates at 20Hz; client renders at rAF with
interpolation for others and prediction+reconciliation for self. Client
sends inputs (held-direction bitmask + seq) at ≤30 msgs/s.

## Loot

| Type | Score | Radius | Notes |
|---|---|---|---|
| SMALL | 10 | 0.3 | 8 at start, respawn to keep ≥6 on field |
| MEDIUM | 25 | 0.35 | 4 at start, respawn to keep ≥3 |
| LARGE | 100 | 0.5 | exactly one, spawns center at T-20s with klaxon |

Pickup = server-verified overlap (player r + loot r + 0.05 tolerance).
Respawn positions from a server-seeded shuffle of 14 fixed spawn points,
never within 2 tiles of a player or the bank.

## Carrying / banking / scatter

`carrying` and `banked` are separate server-side scores. Entering the bank
zone auto-converts carrying→banked (no keypress — lowest friction, most
readable; the HUD flashes BANKED +N). Player-player overlap triggers SCATTER:
the player with the **higher carrying** drops 50% of carrying (rounded down),
re-materialized as small/medium pickups in a ring around the collision
point; both players get 1.5s immunity (rendered as blinking). banked is
untouchable. Equal carrying (incl. 0-0) → no effect. This makes the leader a
target and chasing profitable, without weapons.

## Match flow & timing

LOBBY (fill window 30s, min 2, max 8 real players) → READY → 3-2-1 →
LIVE 90s → at T-20s: HUD intensifies, leaderboard enlarges, LARGE cache →
10s/5s/3-2-1 callouts → MATCH OVER: pickups/banking frozen in that order,
scores finalized, rankings computed (banked desc; tie → earlier last-bank
timestamp wins), canonical result hashed → SETTLEMENT → result screen.

## Result screens

Winner: rank, points, PAYOUT PENDING → SETTLEMENT CONFIRMED (+amount), streak,
[PLAY AGAIN]. Non-winners: rank + points + "SO CLOSE." + [RUN IT BACK] — no
"YOU LOST" dead ends. Rematch re-queues into the next room in <3s.

## HUD priorities (always visible)

BANKED · CARRYING (highlighted when >0 — "exposed") · TIME · live
leaderboard (rank, alias, banked; local player highlighted) · bank direction
hint when carrying > 100. Bottom line: ARCH TESTNET · ROOM #NN · settlement
state. Nothing else during play.

## Controls & accessibility

WASD/arrows only (banking is positional). Keyboard-first; all state also as
text (scores, ranks, timer); immunity/danger shown by blink+outline, not
color alone. Desktop-first: 1280+ primary, 1024 supported.

## Audio (event layer, never required)

join, countdown, pickup (pitch by value), bank (satisfying cash), scatter,
rank_up/down, final-countdown accelerando, win/loss, settlement chime.

## Art direction

CoinUp family: pixel law (1px=1hex, no AA/gradients on sprites,
nearest-neighbor), palette from the brand book with Scramble's own accent
(loot gold `#FCC76E` on void `#000012`), CRT scanline shell around the
canvas, chunky scoreboard type (Press Start 2P). All arena art NEW — player
sprites (8 palette-swapped runners), loot crates/chips with Bitcoin/UTXO
motifs, vault/bank tiles, wall tiles. Chip the Arcade Manager may host the
lobby. No copied Crazy Wheel artwork.

## Practice mode

Local-only, labeled PRACTICE MODE everywhere, 3 wandering bots with simple
loot-seeking AI, no wallet, no chain, no shared leaderboard.

## The last-20-seconds rule (the soul of the game)

The LARGE cache must create the spec §161 moment: leader defends, chasers
gamble, someone banks at 0:02. Playtesting tunes cache position and value
before anything ships.
