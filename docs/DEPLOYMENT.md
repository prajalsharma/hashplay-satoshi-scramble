# DEPLOYMENT

Three moving parts: the **frontend** (static — Vercel), the **realtime server**
(long-lived WS — Fly/Railway), and the **program** (Arch testnet). The
frontend alone gives working PRACTICE mode; live rooms need the server; real
stakes need the deployed program.

## 1. Clone & install
```bash
git clone https://github.com/prajalsharma/hashplay-satoshi-scramble
cd hashplay-satoshi-scramble
npm install
npm install --prefix server
```

## 2. Local run
```bash
# terminal 1 — realtime server (dev freejoin skips on-chain entry)
GAME_DEV_FREEJOIN=1 npm run dev:server        # ws://127.0.0.1:8890
# terminal 2 — frontend
npm run dev                                    # http://localhost:5173
```
Open the URL → PRACTICE plays immediately; live rooms use the local server.

## 3. Program (Arch testnet)
```bash
scripts/deploy-and-init.sh      # builds SBF, funds authority, deploys
# → writes .scramble-program-id (hex). Then initialize + smoke:
SCRAMBLE_PROGRAM_ID=$(cat .scramble-program-id) \
  server/node_modules/.bin/tsx scripts/testnet-e2e.mts
```
Deploy authority key: `programs/scramble/.deploy-authority.json` (gitignored;
raw secret — never commit). This key is BOTH the config authority and, in this
deployment, the settlement authority (documented single-key setup; production
splits them).

## 4. Frontend → Vercel
Import the repo. Framework: **Vite**. Build `npm run build`, output `dist`.
Env (all public):
```
VITE_ARCH_RPC_URL=https://rpc.testnet.arch.network
VITE_ARCH_INDEXER_URL=https://explorer.arch.network/api/v1/testnet
VITE_SCRAMBLE_ASSET_MINT=1d46e0dd87393236e4e01252439f46dcbaec7c2255d1fd734e61771a00e8f4e9
VITE_SCRAMBLE_PROGRAM_ID=<hex from step 3>
VITE_GAME_WS_URL=wss://<your-server-host>/ws
```

## 5. Realtime server → Fly/Railway
A persistent Node process — NOT a Vercel serverless function. Deploy `server/`
with `npm start`. Env (SECRET stays here):
```
PORT=8890
HOST=0.0.0.0
CORS_ORIGINS=https://<your-app>.vercel.app
ARCH_RPC_URL=https://rpc.testnet.arch.network
SCRAMBLE_PROGRAM_ID=<hex>
SCRAMBLE_ASSET_MINT=1d46e0dd87393236e4e01252439f46dcbaec7c2255d1fd734e61771a00e8f4e9
SERVER_SIGNING_PRIVATE_KEY=<64-hex settlement authority secret>   # SECRET
```
The `SERVER_SIGNING_PRIVATE_KEY` must be the key whose pubkey was passed to
`init_config` as the settlement authority (i.e. the deploy authority in the
single-key setup). Generate the pinned pair with the build step; export the
64-hex secret into the host's secret store — never into git or the frontend.

## 6. Smoke test
Two browsers, two Taproot wallets holding aBTC → same room → pay entry →
play → match ends → settlement confirmed on-chain → refresh preserves result.

## Notes
- No database. Rooms are in-memory; match/settlement truth is on-chain.
- No API keys anywhere (Arch RPC + indexer are keyless — verified).
- Mainnet is not wired; the UI shows ARCH TESTNET permanently this phase.
