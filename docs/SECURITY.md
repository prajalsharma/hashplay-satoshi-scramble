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

## Wallet-safety audit (2026-08-29)

**Finding (fixed): session-auth signature could be replayed as a transaction.**
The WebSocket sign-in originally signed the server's raw nonce with the same
BIP-322 primitive used for transactions. A malicious server could have sent a
nonce that was actually a transaction message hash; the wallet would sign it as
"login" and the server could replay that signature as a real transaction —
a potential aBTC drain. **Fix**: sign-in now uses a distinct, READABLE
SIWE-style message (`loginMessage()` in shared/protocol.ts) via each wallet's
message-signing UI. A login signature is over a human sentence, never a bare
32-byte hash, so it can never be a valid transaction signature (regression
test: tests/security.test.ts). The server verifies that exact message.

**Hardening**: the client reconnects with capped exponential backoff (6 tries)
and NEVER re-prompts the wallet on reconnect — it resumes via a session token,
so a downed server can't trigger repeated wallet popups. One sign-in per
session, by design.

**No other signing surface**: the ONLY transaction a player ever signs is
`join_match` (entry escrow), shown by the wallet as a token transfer of
0.0001 aBTC. The game holds no keys; there is no auto-generated browser key,
no auto-connect, no identity created before the user acts. The server's
settlement key can only attest rankings within a match's own escrowed pot
(see FAIRNESS.md) — it cannot move a player's wallet funds.
