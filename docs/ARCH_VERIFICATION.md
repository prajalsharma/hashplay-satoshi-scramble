# ARCH VERIFICATION

Classification per the no-hallucination policy: VERIFIED = executed against
real infrastructure (dates given). INFERRED and UNKNOWN marked explicitly.
Primary evidence: the sibling project's live deployments and this session's
probes (2026-08-28/29).

| Operation | Method | Source | Version | Network | Status |
|---|---|---|---|---|---|
| RPC connection | JSON-RPC POST `get_block_count`, `get_version` | rpc.testnet.arch.network | node 0.8.6 | testnet | VERIFIED 08-28 |
| Account read | `read_account_info` | RPC | — | testnet | VERIFIED (used everywhere) |
| Native faucet | `request_airdrop` (32-byte pubkey; funds ANY key ~1,000,000 units; 7–50s) | RPC | — | testnet | VERIFIED 08-28 |
| Program accounts scan | `get_program_accounts [program_id, null]` | RPC | — | testnet | VERIFIED 08-28 (powers serverless boards) |
| Tx submit | `send_transaction {version:0, signatures:[[64B]], message}` | RPC | — | testnet | VERIFIED (hundreds of txs) |
| Tx status | `get_processed_transaction`; normalize `"Processed"` / `{type:"processed"}` / `{Failed:"…"}` | RPC | — | testnet | VERIFIED |
| Message build+hash | `SanitizedMessageUtil.createSanitizedMessage` + `.hash` (double-sha256 → UTF-8 of 64-hex; matches arch_program `sanitized.rs`) | @arch-network/arch-sdk | **0.0.28** (0.0.27 = broken empty publish — verified) | — | VERIFIED |
| BIP-322 signing (local key) | taproot key-spend to_spend/to_sign, SIGHASH_DEFAULT | @scure/btc-signer 2.3.0 impl mirroring arch_sdk `sign_message_bip322` | — | testnet | VERIFIED (accepted first try) |
| PDA derivation | `Pubkey::find_program_address` / `PubkeyUtil.findProgramAddress` (byte-identical JS↔Rust) | arch_program 0.8.6 / SDK | — | — | VERIFIED |
| ATA derivation/create | `getAssociatedTokenAddress(mint, owner, allowOffCurve)`; idempotent create data `[1]` | SDK + apl-associated-token-account 0.8.6 | — | testnet | VERIFIED |
| APL token escrow | Transfer (tag 3) in by player sig; out via match-PDA `invoke_signed`; MintTo (tag 7) | apl-token 0.8.6 | — | testnet | VERIFIED (aUSD program settled real funds 08-28) |
| On-chain clock | `get_clock().unix_timestamp` deadlines + claims | arch_program | 0.8.6 | testnet | VERIFIED |
| Program deploy | `cargo build-sbf` (Agave 3.1.10) → `arch-cli --profile testnet deploy target/deploy/ --generate-if-missing --fund-authority` | arch-cli 0.8.6 (0.6.7 CANNOT deploy — 1232-byte tx limit, verified failure) | — | testnet | VERIFIED (3 deployments) |
| Indexer: token metadata/holdings | GET `/api/v1/testnet/tokens/{mint}`, `/accounts/{addr}/tokens` | explorer.arch.network — **keyless** | — | testnet | VERIFIED 08-29 |
| Indexer WebSocket | — | `wss://explorer.arch.network/ws/testnet` and variants refuse; official arch-indexer repo is REST-only | — | — | VERIFIED ABSENT — do not build against it |
| ARCH_API_KEY | — | every endpoint above is keyless; only Arch's Wallet-Hub `/v1` service wants keys (unused here) | — | — | VERIFIED UNNECESSARY |
| Tx fee | ~5,000 native units per transaction | observed ledger deltas | — | testnet | VERIFIED 08-28 |
| aBTC mint | `/tokens/1d46e0dd…` → "Arch BTC", aBTC, 8dp, 292 holders | indexer | — | testnet | VERIFIED 08-29 |
| Wallet Hub (email wallets, faucet) | hub.arch.network/v1 → 401 "Missing API key" | live probe | sdk 0.1.1 | — | VERIFIED KEY-GATED — out of MVP scope |
| aBTC public faucet path | — | — | — | testnet | **UNKNOWN — REQUIRES VERIFICATION** |
| Xverse/Phantom/Leather direct signing | implemented per provider docs + Arch Wallet extension source conventions | — | — | testnet | INFERRED-correct; human test pending |

Rule for this repo: any operation not in this table gets verified (and added
here, dated) before code depends on it.
