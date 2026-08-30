# TESTNET — verified values

| Item | Value | Verified |
|---|---|---|
| Network | Arch **testnet** only | live |
| RPC | `https://rpc.testnet.arch.network` (node 0.8.6) | live 2026-08-29 |
| Indexer (keyless) | `https://explorer.arch.network/api/v1/testnet` | live |
| Explorer WebSocket | none exists — do not use | verified absent |
| API key | none needed (all endpoints keyless) | verified |
| Stake asset | aBTC ("Arch BTC"), 8 decimals, mint `2yHWVNYyjnsxZqpnvTbPzWiHwpNQ2zBQU6BC4Lnbu7sW` / hex `1d46e0dd87393236e4e01252439f46dcbaec7c2255d1fd734e61771a00e8f4e9` | live |
| Token program | `TokenT4em53UrV4gSvZ3nCS2mZeHaqTLapwt6iZt6Mk` (apl-token 0.8.6) | verified |
| Entry | 10,000 base units = 0.0001 aBTC (SCRAMBLE_V1, frozen) | — |
| Program ID | see `.scramble-program-id` after deploy | pending faucet |
| CLI | arch-cli 0.8.6 (testnet profile) · cargo-build-sbf 3.1.10 | installed |

## Wallet requirements
A Bitcoin wallet with a **Taproot (P2TR)** address and some testnet **aBTC**:
Arch Wallet extension (recommended — human-verified), UniSat, Xverse,
Phantom, or Leather. The **player creates no on-chain account** when joining
(the server/authority creates the Match PDA + vault ATA and funds their
Solana-style rent), so a player needs aBTC to stake and essentially no native
balance of their own — the frontend does NOT airdrop to the player. Getting
testnet aBTC is via holding/transfer (Arch documents no public aBTC faucet).

Note: with the Arch Wallet the approval popup renders a Bitcoin "Sign
Transaction" PSBT with a single **OP_RETURN** output — this is the standard
**BIP-322** to-sign transaction (a zero-value dummy), NOT a real BTC spend; it
moves no Bitcoin. Confirmed against Arch-Network/arch-wallet-connect-kit.

## Match flow (on-chain)
1. Server `create_match(match_id, max_players)` → creates the Match PDA + its
   aBTC vault ATA (settlement authority signs).
2. Each player `join_match` → transfers 10,000 aBTC base units into the vault
   (player signs; capacity/duplicate/deadline enforced on-chain).
3. Play (off-chain, authoritative server).
4. Server `settle_match(result_hash, rankings)` → program pays the vault out
   70/20/10 to ranks 1-3 (winner-takes-all under 4 players), marks terminal.
5. If it never settles, any player `reclaim_entry` after the settle deadline
   → full entry back.

## Funding / faucet status
- Native gas: `request_airdrop` (permissionless) — normally 7-50s.
- aBTC: no public faucet located (Arch's faucet is behind hub.arch.network,
  key-gated). Players transfer aBTC to each other; entry kept tiny.
- **KNOWN OUTAGE 2026-08-29**: the native airdrop faucet stopped landing funds
  mid-session (RPC + indexer stayed healthy). Deploy/E2E are scripted and fire
  automatically on recovery — see DEPLOYMENT.md and CHANGELOG.md.
