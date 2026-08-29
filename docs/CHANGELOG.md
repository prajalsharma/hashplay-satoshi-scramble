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
