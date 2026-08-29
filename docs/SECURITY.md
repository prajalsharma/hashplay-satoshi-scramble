# SECURITY

## Trust boundaries

PLAYER trusts their wallet's signing UI. CLIENT is untrusted by everyone.
SERVER is trusted for gameplay outcomes only (see FAIRNESS.md), and holds
exactly one secret. PROGRAM is trusted for money and enforces its own rules
regardless of server honesty. INDEXER/RPC are read layers — never authority.

## Threat table

| Threat | Guard | Authority |
|---|---|---|
| Client fakes score/position/pickup | server simulates everything; client messages are requests | server |
| Speed/teleport hacks | max-speed integration; server position is truth | server |
| Input flooding / replay / reorder | seq monotonicity, ≤30 inputs/s, per-type rate caps | server |
| Duplicate pickup/bank | loot IDs consumed server-side; bank idempotent per tick | server |
| Fake players / phantom entries | a player exists only after an on-chain `join_match` escrow | program |
| Duplicate join / over-capacity / late join | players[] scan, joined<max, join deadline checks | program |
| Double settlement | one-way terminal match state | program |
| Oversized/misdirected payout | split computed on-chain from stored entries; recipients must be registered players' ATAs (re-derived) | program |
| Settlement forgery | pinned settlement-authority pubkey must sign | program |
| Server death strands funds | `reclaim_entry` after settle deadline, per-player claim flags | program |
| Refund double-claim | per-player claimed flag inside Match | program |
| PDA/account substitution | every PDA re-derived from stored state; owner+signer checks | program |
| Wrong asset | vault ATA + player ATAs derived from the config mint | program |
| WS spoofing/session theft | per-connection auth token + resume token; origin-scoped | server |
| Disconnect abuse (see below) | explicit rules + reconnect window | server |
| Secret leakage | one secret (`SERVER_SIGNING_PRIVATE_KEY`), env-only, never logged; deploy keys local+gitignored; no API keys exist | ops |

## Race conditions

Join vs capacity: serialized by the on-chain account write — the (max+1)th
join transaction fails cleanly ("ROOM FULL"). Bank vs scatter on the same
tick: server applies bank first if zone-entry preceded overlap in the tick's
event order (deterministic ordering documented in code). Settle vs reclaim:
whichever lands first wins; the loser fails on the terminal state — funds
move exactly once either way.

## Disconnect / reconnect rules

- LOBBY (pre-escrow): slot freed immediately.
- LOBBY (escrowed, match not started): player kept 60s; if the match starts
  without them reconnecting they remain a registered player with score 0
  (their entry stays in the pot — documented, prevents join-griefing);
  if the room never fills, normal refund path applies.
- LIVE: avatar persists 15s (idle, tag-immune after 3s so it isn't free
  loot); reconnect within 15s resumes position/score via resume token; after
  15s the avatar sleeps at the wall until reconnect or match end — scores
  keep counting (banked stays banked).
- Server crash mid-match: no settlement happens → every player reclaims their
  entry after the deadline. No partial results are ever attested.

## Logging & observability

Structured events (`room:*, match:*, loot:*, settlement:*`) with match_id /
player_id / seq. Never logged: keys, tokens, signatures, full payloads of
signed material.

## Admin surface

None beyond env config (rooms, entry, timeouts) and the deploy/init scripts.
No UI or endpoint can move user funds.
