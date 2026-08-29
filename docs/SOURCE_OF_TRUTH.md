# SOURCE OF TRUTH MATRIX

| Fact | Authority | Notes |
|---|---|---|
| Wallet address / keys | the player's wallet | game never holds player keys |
| Entry payment / escrow | **Arch program** (Match PDA's aBTC ATA) | a player "exists" in a live match only after their join tx |
| Room roster & capacity | Arch program (players[], joined) | server mirrors it; chain decides races |
| Room metadata / discovery | game server (live) + `get_program_accounts` (anyone can audit) | serverless fallback proven |
| Player movement / position | realtime server | client prediction is cosmetic |
| Loot positions / spawns | realtime server (seeded schedule) | |
| Loot pickup / scatter | realtime server | client only requests |
| Carrying / banked scores | realtime server | never client-supplied |
| Match timer / phase | realtime server | on-chain deadlines bound the money side |
| Leaderboard (during match) | realtime server broadcast | |
| Final match result | canonical SCRAMBLE_V1 encoding, SHA-256 hashed, signed by pinned settlement authority | the documented trust point (FAIRNESS.md) |
| Settlement / payout | **Arch program** — split computed on-chain from escrowed entries; terminal states | server attests rankings, cannot size payouts |
| Refunds | **Arch program** — player-claimable after settle deadline | survives server death |
| Transaction confirmation | RPC `get_processed_transaction` (+ indexer) | UI never claims CONFIRMED early |
| Balances / holdings display | RPC + keyless indexer | display only; programs re-check on-chain |
| Player alias | local profile (server-registered later) | wallet address is the durable identity |
| Animations / sound / HUD | client | presentational |
