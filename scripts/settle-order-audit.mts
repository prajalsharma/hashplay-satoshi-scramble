/**
 * Audit for the settle-ordering fix: settle a match where the server's result
 * order (joinOrder) is DELIBERATELY different from the on-chain m.players order,
 * exercising settleOnChain's remap. Without the fix this reverts; with it, each
 * winner is paid the correct rank amount.
 *
 *   SCRAMBLE_PROGRAM_ID=<hex> SCRAMBLE_ASSET_MINT=<hex> \
 *   SERVER_SIGNING_PRIVATE_KEY=<authority 64hex> \
 *   server/node_modules/.bin/tsx scripts/settle-order-audit.mts
 */
import { readFileSync } from "node:fs";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils.js";
import { localSigner, type ArchSigner } from "../src/arch/signer.ts";
import { ensureGas, readAccount } from "../src/arch/rpc.ts";
import { signAndSend } from "../src/arch/txSend.ts";
import {
  ataOf, createAtaIdempotentIx, createMatchIx, decodeMatch, decodeTokenAmount,
  joinMatchIx, matchPda, mintPk,
} from "../src/arch/program.ts";
import { PubkeyUtil, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@arch-network/arch-sdk";
import { ENTRY_BASE_UNITS, RULESET_VERSION } from "../src/shared/constants.ts";
import type { CanonicalResult } from "../src/shared/types.ts";
import { settleOnChain } from "../server/src/chain.ts";

const log = (s: string) => console.log(s);
const key = (p: string) => { const s = readFileSync(p, "utf8").trim(); return localSigner(/^[0-9a-f]{64}$/i.test(s) ? Uint8Array.from(Buffer.from(s, "hex")) : Uint8Array.from(JSON.parse(s).slice(0, 32))); };
const authority = key("programs/scramble/.deploy-authority.json");
const mintAuthority = key("/Users/prajalsharma/coinup/programs/arch-duel/target/deploy/arch_duel-authority.json");
const u64 = (n: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, n, true); return b; };
const tokenBal = async (owner: Uint8Array) => decodeTokenAmount((await readAccount(ataOf(owner)))?.data ? Uint8Array.from((await readAccount(ataOf(owner)))!.data) : null);
async function mintTo(dest: Uint8Array, amount: bigint) {
  const MINT = mintPk();
  const ata = PubkeyUtil.getAssociatedTokenAddress(MINT, dest, true) as unknown as Uint8Array;
  await signAndSend(mintAuthority, [
    { program_id: ASSOCIATED_TOKEN_PROGRAM_ID, accounts: [
      { pubkey: mintAuthority.publicKey, is_signer: true, is_writable: true },
      { pubkey: ata, is_signer: false, is_writable: true },
      { pubkey: dest, is_signer: false, is_writable: false },
      { pubkey: MINT, is_signer: false, is_writable: false },
      { pubkey: new Uint8Array(32), is_signer: false, is_writable: false },
      { pubkey: TOKEN_PROGRAM_ID, is_signer: false, is_writable: false },
    ], data: Uint8Array.of(1) },
    { program_id: TOKEN_PROGRAM_ID, accounts: [
      { pubkey: MINT, is_signer: false, is_writable: true },
      { pubkey: ata, is_signer: false, is_writable: true },
      { pubkey: mintAuthority.publicKey, is_signer: true, is_writable: false },
    ], data: concatBytes(Uint8Array.of(7), u64(amount)) },
  ]);
}

async function main() {
  log(`program ${process.env.SCRAMBLE_PROGRAM_ID!.slice(0, 12)}… asset ${bytesToHex(mintPk()).slice(0, 12)}…`);
  await ensureGas(authority.publicKey, 300_000);
  await ensureGas(mintAuthority.publicKey, 300_000);
  // 4 players join in a KNOWN order → on-chain m.players = [P0,P1,P2,P3].
  const players: ArchSigner[] = [];
  for (let i = 0; i < 4; i++) {
    const p = localSigner(crypto.getRandomValues(new Uint8Array(32)), `P${i}`);
    players.push(p);
    await ensureGas(p.publicKey, 300_000);
    await mintTo(p.publicKey, ENTRY_BASE_UNITS * 5n);
  }
  const matchId = BigInt(Date.now());
  const mp = matchPda(matchId);
  await signAndSend(authority, [createAtaIdempotentIx(authority.publicKey, mp), createMatchIx(authority.publicKey, matchId, 4)]);
  for (const p of players) await signAndSend(p, [joinMatchIx(p.publicKey, matchId)]); // sequential → m.players = P0..P3
  const onchain = decodeMatch(Uint8Array.from((await readAccount(mp))!.data))!.players.slice(0, 4);
  log(`on-chain m.players: ${onchain.map((h) => h.slice(0, 6)).join(",")}`);

  // SHUFFLE: server result order = reversed [P3,P2,P1,P0], winner order P0>P2>P1>P3.
  const shuffled = [players[3]!, players[2]!, players[1]!, players[0]!];
  const winnerOrder = [players[0]!, players[2]!, players[1]!, players[3]!]; // best first
  const rankings = winnerOrder.map((w) => shuffled.findIndex((s) => s.publicKeyHex === w.publicKeyHex));
  log(`server joinOrder (shuffled): ${shuffled.map((p) => p.publicKeyHex.slice(0, 6)).join(",")} · rankings ${JSON.stringify(rankings)}`);
  const result: CanonicalResult = {
    game: "satoshi-scramble", ruleset: RULESET_VERSION, matchId, roomId: "AUDIT",
    entry: ENTRY_BASE_UNITS, players: shuffled.map((p) => ({ id: p.publicKeyHex, banked: 0n })),
    rankings, startTs: 1, endTs: 2,
  };
  const before = await Promise.all(players.map((p) => tokenBal(p.publicKey)));
  const { txid } = await settleOnChain(result);
  log(`settled tx=${txid.slice(0, 12)}…`);
  for (let i = 0; i < 25 && (await tokenBal(mp)) !== 0n; i++) await new Promise((r) => setTimeout(r, 1000));
  await new Promise((r) => setTimeout(r, 2000));
  const after = await Promise.all(players.map((p) => tokenBal(p.publicKey)));
  const gain = (i: number) => after[i]! - before[i]!;
  log(`gains — P0:${gain(0)} P1:${gain(1)} P2:${gain(2)} P3:${gain(3)} (expect P0=28000 P2=8000 P1=4000 P3=0)`);
  const ok = gain(0) === 28000n && gain(2) === 8000n && gain(1) === 4000n && gain(3) === 0n && (await tokenBal(mp)) === 0n;
  if (!ok) throw new Error("AUDIT FAILED — shuffled-order settlement did not pay correctly");
  log("SETTLE-ORDER AUDIT PASSED — shuffled joinOrder settled correctly via on-chain remap");
}
main().catch((e) => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
