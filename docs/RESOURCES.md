# RESOURCES

| Resource | Existing/New | Source | Version | Purpose | Status |
|---|---|---|---|---|---|
| Frontend framework | NEW (choice open: Vite vs Next static) | npm | latest stable at impl | shell/HUD | pending gate |
| Game engine | NEW (none) | hand-rolled Canvas 2D | — | arena render/sim | planned |
| Rendering | Canvas 2D + DOM | browser | — | arena + HUD | planned |
| Realtime transport | `ws` | npm | ^8 (8.21.1 proven in sibling) | WS server | planned |
| Server runtime | Node + `tsx` + TypeScript | npm | ≥20 / ^4 / ^5 | authoritative sim | planned |
| Wallet: Arch Wallet ext | EXISTING pattern | window.arch (open source: Arch-Network/arch-wallet-hub apps/chrome-wallet) | user's install | connect+sign | VERIFIED (human, real funds, 2026-08-28) |
| Wallet: UniSat | EXISTING pattern | window.unisat, bip322-simple | user's install | connect+sign | implemented in sibling; via-Arch-Wallet human-proven |
| Wallet: Xverse / Phantom-BTC / Leather | EXISTING pattern | injected providers | — | connect+sign | implemented; human test pending |
| Arch TS SDK | EXISTING | `@arch-network/arch-sdk` | **0.0.28 pinned** (0.0.27 broken publish) | message build, PDAs, ATAs | VERIFIED live |
| BIP-322 signer | EXISTING pattern (re-impl) | `@scure/btc-signer` + `@noble/curves` + `@noble/hashes` | 2.3.0 / 2.4.0 / 2.4.0 | local-key + witness parsing | VERIFIED live |
| Arch RPC | EXISTING | https://rpc.testnet.arch.network | node 0.8.6 | tx submit, reads, airdrop, get_program_accounts | VERIFIED live |
| Arch Explorer/indexer | EXISTING | https://explorer.arch.network/api/v1/testnet | — | tokens/holdings/tx status (keyless; NO WS) | VERIFIED live |
| Program SDK (Rust) | EXISTING | `arch_program`, `apl-token`, `apl-associated-token-account` | 0.8.6 | escrow program | VERIFIED (two deployed programs) |
| Build/deploy tooling | EXISTING | Agave cargo-build-sbf 3.1.10; arch-cli 0.8.6 (testnet profile) | installed | program deploy | VERIFIED live |
| Token (stake) | EXISTING | official aBTC `2yHWVNYy…` | 8 dp | entry/pot/payout | VERIFIED (see ASSET_MODEL) |
| Database | none | — | — | not needed for MVP (chain + memory) | decided |
| Assets (art/audio) | NEW | original, pixel law | — | see ASSET_INVENTORY | planned |
| Fonts | EXISTING | Press Start 2P, Inter (Google) | — | UI | decided |
| Hosting: client | Vercel | — | — | static | deferred gate |
| Hosting: realtime server | Fly.io or Railway | — | — | WS host | deferred gate |
| Tests | node:test / vitest + program integration vs live testnet | npm / cargo | — | see spec §134 | planned |
| Prior art (reference only) | `~/coinup` (MIT) | github.com/prajalsharma/coinup | — | patterns, brand | audited |
