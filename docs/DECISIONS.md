# DECISION LOG

**2026-08-29 · Standalone sibling repo** — `~/hashplay-satoshi-scramble` →
`prajalsharma/hashplay-satoshi-scramble`; no imports from ~/coinup.
Alternatives: monorepo/game-module in coinup — rejected: spec mandate +
independent deployability. Impact: clean re-implementation of proven libs.

**2026-08-29 · Stake asset = official testnet aBTC** (8dp, mint `2yHWVNYy…`).
Alternatives: official aUSD (works, but spec prefers aBTC and the arcade's
identity is Bitcoin), native units (gas-only role now). Rejected because:
aBTC verified live and custody pattern proven. Impact: ASSET_MODEL.md;
faucet path still UNKNOWN.

**2026-08-29 · Custom authoritative WS server, 20Hz** — not Colyseus (the
production Archade's stack). Rejected because: spec §47 says simple first;
the seq/snapshot/resync pattern is already proven in-house. Revisit only if
room scaling hurts.

**2026-08-29 · Canvas 2D, no Three.js** — retro top-down arena gains nothing
from 3D; spec §72 concurs.

**2026-08-29 · Settlement = pinned server-attestation key; program computes
payout amounts from escrowed entries** — honest MVP trust model (FAIRNESS).
Alternatives: fully on-chain gameplay (impossible at 20Hz), commit-reveal
replays (future path, kept open by canonical results + ruleset versions).

**2026-08-29 · Refund escape hatch mandatory** — `reclaim_entry` after settle
deadline, per-player claim flags. Learned from coinflip-escrow's H-3; server
death must never strand funds.

**2026-08-29 · Auto-bank on zone entry** (no keypress). Alternatives: [G]
press (spec sketch), channel time. Rejected because: fewer messages, instant
readability; tension comes from reaching the zone, not pressing a key.
Revisit in playtests if banking feels unearned.

**2026-08-29 · Scatter rule** — on player overlap the higher-carrier drops
50% of carrying as pickups; 1.5s mutual immunity; banked untouchable.
Alternatives: full drop (too punishing), steal-direct (rich-get-richer),
weapons (spec §19 forbids). Impact: chase-the-leader dynamics.

**2026-08-29 · Economy defaults** — entry 10,000 base units; 70/20/10 top-3;
winner-takes-all at N=2-3; no fee; full-refund policy. Status: WORKING
DEFAULTS awaiting explicit product confirmation before program freeze.

**2026-08-29 · No fake players, ever, in live mode** — bots only in labeled
practice. Non-negotiable spec rule adopted.

**2026-08-29 · No database for MVP** — chain + in-memory rooms suffice;
histories derivable from `get_program_accounts`.

**2026-08-29 · Spec corrections adopted with evidence** — no Explorer
WebSocket exists; no ARCH_API_KEY needed (all consumed endpoints keyless).
The spec's contrary lines are superseded by live verification
(ARCH_VERIFICATION.md).
