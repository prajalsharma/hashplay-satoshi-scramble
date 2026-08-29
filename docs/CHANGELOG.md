# CHANGELOG

Every meaningful change appends here: DATE · CHANGE · WHY · FILES · TESTS ·
GAMEPLAY IMPACT · ARCH IMPACT. Future tweak sessions MUST update this file
(and read CONTEXT.md, DECISIONS.md, ARCHITECTURE.md first — spec §112).

---

**2026-08-29 · Discovery** — Repo created (local + GitHub, standalone);
official testnet aBTC verified live as the stake asset; wallet/Arch/program
capabilities carried over from the sibling project's live verifications.
Files: README, .gitignore, docs/DISCOVERY.md. Tests: live probes only (no
code yet). Gameplay: n/a. Arch: asset + capability table established.

**2026-08-29 · Documentation gate (§157)** — Full doc set authored:
CONTEXT, DESIGN (SCRAMBLE_V1 numbers locked as tunable defaults),
ARCHITECTURE, FAIRNESS, SECURITY, ASSET_MODEL, ASSET_INVENTORY, RESOURCES,
WALLETS, ARCH_VERIFICATION, SOURCE_OF_TRUTH, DECISIONS, CHANGELOG. Tests:
n/a. Gameplay: rules defined on paper. Arch: program shape + trust model
specified; economy marked "working defaults pending confirmation".
Implementation NOT started (next gate: repo shell + renderer, spec §158
steps 1-2).

**2026-08-29 · Implementation steps 1-10 + full stack** — Built the game:
shared deterministic SCRAMBLE_V1 sim (movement/collision/loot/scatter/bank/
large-cache), Canvas renderer, authoritative 20Hz WS server (rooms, protocol,
anti-cheat, canonical result + hash), practice mode (labeled, local bots),
ArchSigner (Arch Wallet/UniSat/Xverse/Phantom/Leather) + verified tx pipeline
+ BIP-322 sign AND verify (server session auth), and the escrow program
(init/create/join/settle/reclaim; exact integer 70/20/10; refund escape
hatch). Tests: 15 unit/shared/result/bip322 + Rust payout math + a real
two-player WS match to result-hash agreement — all green. Vite build 93KB gz;
frontend + server typecheck clean. Files: src/shared/*, src/arch/*, src/game/*,
src/App.tsx, server/src/*, programs/scramble/*, tests/*, scripts/*, docs
(DEPLOYMENT, TESTNET), README. Gameplay: the full loop is playable now.
Arch: program compiled + SBF-built; deploy authority pinned.

**2026-08-29 · BLOCKED on program deploy — testnet faucet outage** — RPC
(block ~12.14M, advancing) and indexer stayed healthy, but `request_airdrop`
stopped landing funds mid-session (funded accounts fine 7-50s earlier the same
day; then 0 lamports across many attempts over >5 min). This blocks funding
the deploy authority, so program deploy + init_config + on-chain E2E +
real-wallet/real-player settlement cannot complete right now. All of it is
scripted (scripts/deploy-and-init.sh, scripts/testnet-e2e.mts) and a
background watcher auto-fires deploy on faucet recovery. Not faked — see
FINAL DELIVERY REPORT "what I need to do manually".

**2026-08-29 · Zero-blocker hardening (release candidate)** — Fixed the build
typecheck (allowImportingTsExtensions for the tsx script/test files). Added
4- and 8-player scaling tests over the real protocol (no fake players) +
disconnect-integrity test — all pass, ~20Hz stable, ~88MB idle. Added
scripts/preflight.mts (fail-fast connectivity/asset/program/config/funding +
faucet-liveness probe) and testnet:preflight/deploy/e2e npm scripts. Wrote
docs/GO_LIVE_TESTNET.md (exact funded recovery sequence). Extended
testnet-e2e.mts guards (duplicate-join, double-settle, reclaim-after-settle).
No gameplay/architecture changes. Faucet still down — on-chain steps remain
BLOCKED-EXTERNAL, fully scripted.
Test status: 4-player VERIFIED, 8-player VERIFIED (see scaling.test.mts)

**2026-08-29 · Wallet-safety fix + UX standards** — SECURITY: session sign-in
no longer signs a raw hash (replay-as-transaction risk); it now signs a
readable SIWE-style message via the wallet's message-signing UI, domain-
separated from transactions (regression test added). Reconnect hardened:
capped backoff, no wallet re-prompt on reconnect (token resume). UX: removed
auto-generated/persisted identity on page load — nothing shows before you act;
the connected wallet is your live identity, the practice name is opt-in.
No gameplay/economy changes. All tests green (unit 13 + 2p + 4p/8p + disconnect).
