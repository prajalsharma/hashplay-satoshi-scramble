# FAIRNESS

**This game is NOT trustless, and we say so.** The MVP is on-chain financial
settlement + server-authoritative realtime gameplay.

## Who controls what

- **Client controls**: rendering, input, prediction, sound. Nothing a
  modified client sends can raise a score, teleport a player, or move money —
  every action is a request the server validates against its own simulation.
- **Server controls**: the match itself — movement, collision, loot, scatter,
  banking, timer, scores, rankings, and the canonical result it signs.
- **Arch (the program) controls**: all money — escrowed entries, the payout
  split computed on-chain from stored entries, single-settlement terminal
  states, and player-claimable refunds.
- **Wallets control**: keys and approvals; the game never sees a private key
  (the server's own signing key excepted, and it can only attest results —
  it cannot mint, redirect, or resize payouts).

## How results are generated

The server simulates deterministically at 20Hz from validated inputs.
Rankings = banked score desc (tie: earlier final bank). The result is
canonically encoded and SHA-256 hashed; `settle_match` carries the ranked
players + hash, signed by the pinned settlement authority.

## How cheating is limited

Server-side: speed/teleport rejection, pickup/bank range checks, seq
monotonicity, rate limits, duplicate-action rejection, no client-supplied
scores anywhere. On-chain: capacity/duplicate-join guards, payout amounts
derived only from escrowed entries, one-way terminal states, per-player
refund claim flags.

## If the server is compromised or dies

Worst case for a **compromised** server: it attests a false ranking — it can
misdirect a match's pot among that match's real, entry-paying players; it can
NEVER pay outsiders, exceed the pot, settle twice, or touch other matches
(program guards). Worst case for a **dead** server: nobody settles — every
player reclaims their full entry on-chain after the settle deadline, with no
cooperation from anyone. Funds cannot strand.

## Path to more on-chain verification (future, out of MVP scope)

Publish input logs + seed for replayable verification; commit the result hash
before payouts with a challenge window; multiple attestors; eventually
on-chain-verifiable deterministic replay. The canonical-result + ruleset
versioning in V1 is designed so these can be added without breaking history.
