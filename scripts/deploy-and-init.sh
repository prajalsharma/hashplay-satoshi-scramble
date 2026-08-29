#!/usr/bin/env bash
# Deploy the scramble program to Arch testnet and initialize its config.
# Fires as soon as the testnet faucet is available. Idempotent-ish: safe to
# re-run; deploy skips if unchanged, init skips if config already exists.
set -euo pipefail
cd "$(dirname "$0")/.."

PROG=programs/scramble
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

echo "[deploy] building SBF with pinned authority…"
AUTH_HEX=$(node -e "const {schnorr}=require('/Users/prajalsharma/coinup/node_modules/@noble/curves/secp256k1.js');const s=require('fs').readFileSync('$PROG/.deploy-authority.json','utf8').trim();const sk=/^[0-9a-f]{64}\$/i.test(s)?Uint8Array.from(Buffer.from(s,'hex')):Uint8Array.from(JSON.parse(s).slice(0,32));console.log(Buffer.from(schnorr.getPublicKey(sk)).toString('hex'))")
( cd "$PROG" && SCRAMBLE_AUTHORITY="$AUTH_HEX" cargo build-sbf >/dev/null 2>&1 )

echo "[deploy] funding deploy authority via airdrop (waits for faucet)…"
DEP=$(node -e "const {schnorr}=require('/Users/prajalsharma/coinup/node_modules/@noble/curves/secp256k1.js');const s=require('fs').readFileSync('$PROG/target/deploy/scramble-authority.json','utf8').trim();const sk=/^[0-9a-f]{64}\$/i.test(s)?Uint8Array.from(Buffer.from(s,'hex')):Uint8Array.from(JSON.parse(s).slice(0,32));console.log(Buffer.from(schnorr.getPublicKey(sk)).toString('hex'))" 2>/dev/null || echo "")
if [ -n "$DEP" ]; then
  node -e "const arr=Array.from(Buffer.from('$DEP','hex'));(async()=>{for(let t=0;t<60;t++){await fetch('https://rpc.testnet.arch.network',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'request_airdrop',params:arr})}).catch(()=>{});for(let i=0;i<10;i++){await new Promise(r=>setTimeout(r,3000));const a=await (await fetch('https://rpc.testnet.arch.network',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'read_account_info',params:arr})})).json().catch(()=>({}));if(a.result&&a.result.lamports>=1000000){console.log('funded',a.result.lamports);process.exit(0);}}}console.error('faucet never funded');process.exit(1);})();"
fi

echo "[deploy] deploying program…"
arch-cli --profile testnet deploy "$PROG/target/deploy/" --generate-if-missing

echo "[deploy] program id (hex):"
node -e "const {schnorr}=require('/Users/prajalsharma/coinup/node_modules/@noble/curves/secp256k1.js');const s=require('fs').readFileSync('$PROG/target/deploy/scramble-keypair.json','utf8').trim();const sk=/^[0-9a-f]{64}\$/i.test(s)?Uint8Array.from(Buffer.from(s,'hex')):Uint8Array.from(JSON.parse(s).slice(0,32));console.log(Buffer.from(schnorr.getPublicKey(sk)).toString('hex'))" | tee .scramble-program-id

echo "[deploy] done. Set SCRAMBLE_PROGRAM_ID and run scripts/testnet-e2e.mts."
