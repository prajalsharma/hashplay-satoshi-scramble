/**
 * Testnet end-to-end (steps 8-10 + 51/53): with a deployed + inited program,
 * two funded players join one match (real aBTC escrow), the server settles a
 * ranked result on-chain, and we assert exact 70/20/10-style payouts plus the
 * replay/refund guards. Requires the faucet to be up.
 *
 *   SCRAMBLE_PROGRAM_ID=<hex> server/node_modules/.bin/tsx scripts/testnet-e2e.mts
 *
 * Uses the TEST aUSD mint by default so a mint-authority can top players up;
 * pass SCRAMBLE_ASSET_MINT + a funding source for aBTC to run the real asset.
 */

import { readFileSync } from "node:fs";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils.js";
import { localSigner, type ArchSigner } from "../src/arch/signer.ts";
import { ensureGas, readAccount } from "../src/arch/rpc.ts";
import { signAndSend } from "../src/arch/txSend.ts";
import {
  ataOf, configPda, createAtaIdempotentIx, createMatchIx, decodeMatch,
  decodeTokenAmount, initConfigIx, joinMatchIx, matchPda, mintPk,
  reclaimEntryIx, settleMatchIx, STATE,
} from "../src/arch/program.ts";
import { PubkeyUtil, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@arch-network/arch-sdk";
import { ENTRY_BASE_UNITS, JOIN_TIMEOUT_SECS, SETTLE_TIMEOUT_SECS } from "../src/shared/constants.ts";
import { encodeResult, resultHash } from "../src/shared/result.ts";
import { RULESET_VERSION } from "../src/shared/constants.ts";
import type { CanonicalResult } from "../src/shared/types.ts";

const log = (s: string) => console.log(s);

function keyFromFile(path: string, label: string): ArchSigner {
  const s = readFileSync(path, "utf8").trim();
  const sk = /^[0-9a-f]{64}$/i.test(s)
    ? Uint8Array.from(Buffer.from(s, "hex"))
    : Uint8Array.from(JSON.parse(s) as number[]).slice(0, 32);
  return localSigner(sk, label);
}

const authority = keyFromFile(
  process.env.SCRAMBLE_AUTHORITY_FILE ?? "programs/scramble/.deploy-authority.json",
  "authority",
);
// Same key doubles as settlement authority in this deployment (documented).
const settlement = authority;
// aUSD test-mint authority so we can fund fresh players for the test.
const mintAuthority = keyFromFile(
  process.env.MINT_AUTHORITY_FILE ?? "/Users/prajalsharma/coinup/programs/arch-duel/target/deploy/arch_duel-authority.json",
  "mint-authority",
);

const u64 = (n: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, n, true); return b; };

async function tokenBal(owner: Uint8Array): Promise<bigint> {
  const a = await readAccount(ataOf(owner));
  return decodeTokenAmount(a ? Uint8Array.from(a.data) : null);
}

async function mintTo(dest: Uint8Array, amount: bigint): Promise<void> {
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

async function run(): Promise<void> {
  if (!process.env.SCRAMBLE_PROGRAM_ID) throw new Error("set SCRAMBLE_PROGRAM_ID=<hex>");
  log(`program ${process.env.SCRAMBLE_PROGRAM_ID.slice(0, 12)}… asset ${bytesToHex(mintPk()).slice(0, 12)}…`);

  log("funding authority gas…");
  await ensureGas(authority.publicKey, 300_000, () => log("  faucet…"));
  await ensureGas(mintAuthority.publicKey, 300_000, () => log("  faucet mint-auth…"));

  // init_config (idempotent: skip if present)
  const cfg = await readAccount(configPda());
  if (!cfg || cfg.data.length === 0) {
    log("init_config…");
    await signAndSend(authority, [
      initConfigIx(authority.publicKey, settlement.publicKey, ENTRY_BASE_UNITS, JOIN_TIMEOUT_SECS, SETTLE_TIMEOUT_SECS),
    ]);
  } else {
    log("config already initialized");
  }

  // Four fresh players (tests the 70/20/10 branch).
  const players: ArchSigner[] = [];
  for (let i = 0; i < 4; i++) {
    const sk = crypto.getRandomValues(new Uint8Array(32));
    const p = localSigner(sk, `P${i}`);
    players.push(p);
    await ensureGas(p.publicKey, 300_000, () => log(`  faucet P${i}…`));
    await mintTo(p.publicKey, ENTRY_BASE_UNITS * 5n); // stake + headroom
  }
  log(`players funded: ${(await Promise.all(players.map((p) => tokenBal(p.publicKey)))).join(", ")} base units each`);

  const matchId = BigInt(Date.now());
  const mp = matchPda(matchId);

  log("create_match (settlement authority) + vault ATA…");
  await signAndSend(settlement, [createAtaIdempotentIx(settlement.publicKey, mp), createMatchIx(settlement.publicKey, matchId, 4)]);

  // Adversarial: fifth key cannot join once full is not yet full — test dup + capacity later.
  log("four joins (real escrow)…");
  for (const p of players) {
    await signAndSend(p, [joinMatchIx(p.publicKey, matchId)]);
  }
  // Duplicate join must fail.
  try {
    await signAndSend(players[0]!, [joinMatchIx(players[0]!.publicKey, matchId)]);
    throw new Error("duplicate join should have failed");
  } catch (e) {
    if (String(e).includes("should have failed")) throw e;
    log("  duplicate join rejected ✓");
  }

  const vaultBefore = await tokenBal(mp);
  log(`vault holds ${vaultBefore} base units (expect ${ENTRY_BASE_UNITS * 4n})`);
  if (vaultBefore !== ENTRY_BASE_UNITS * 4n) throw new Error("vault mismatch");

  // Rank P2 > P0 > P3 > P1 (indices into join order).
  const rankings = [2, 0, 3, 1];
  const before = await Promise.all(players.map((p) => tokenBal(p.publicKey)));
  const result: CanonicalResult = {
    game: "satoshi-scramble", ruleset: RULESET_VERSION, matchId, roomId: "E2E",
    entry: ENTRY_BASE_UNITS,
    players: players.map((p) => ({ id: p.publicKeyHex, banked: 0n })),
    rankings, startTs: 1, endTs: 2,
  };
  const hash = resultHash(result);
  log(`settle_match (bytes=${encodeResult(result).length} hash=${hash.slice(0, 12)}…)…`);
  const winners = rankings.slice(0, 3).map((idx) => players[idx]!.publicKeyHex);
  await signAndSend(settlement, [settleMatchIx(settlement.publicKey, matchId, hash, rankings, winners)]);

  // Settlement transfers can lag across RPC read replicas; reading balances
  // immediately after settle returns stale values (flaky, looked like a bug).
  // Wait for the vault to reflect 0 (all transfers propagated), then read.
  for (let i = 0; i < 25 && (await tokenBal(mp)) !== 0n; i++) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  await new Promise((r) => setTimeout(r, 2000));
  const after = await Promise.all(players.map((p) => tokenBal(p.publicKey)));
  const pot = ENTRY_BASE_UNITS * 4n; // 40,000
  const expect = [pot * 70n / 100n, pot * 20n / 100n, pot - (pot * 70n / 100n) - (pot * 20n / 100n)];
  const gain = (i: number) => after[i]! - before[i]!;
  log(`payouts — P2(#1): +${gain(2)} P0(#2): +${gain(0)} P3(#3): +${gain(3)} P1(#4): +${gain(1)}`);
  log(`DEBUG vault after settle: ${await tokenBal(mp)} (0 = fully paid; 4000 = rank3 stranded) · expected split [${expect.join(", ")}]`);
  {
    const mNow = decodeMatch(Uint8Array.from((await readAccount(mp))!.data))!;
    const eOrder = players.map((p) => p.publicKeyHex);
    log(`DEBUG on-chain m.players order matches e2e join order: ${JSON.stringify(mNow.players.slice(0, 4)) === JSON.stringify(eOrder)}`);
    for (let k = 0; k < 3; k++) {
      const winnerHex = mNow.players[rankings[k]!]!;
      const bal = await tokenBal(hexToBytes(winnerHex));
      log(`DEBUG rank${k + 1} winner=${winnerHex.slice(0, 8)} balance=${bal} (expected 50000 - 10000 + ${expect[k]} = ${50000n - 10000n + expect[k]!})`);
    }
  }
  if (gain(2) !== expect[0]) throw new Error(`rank1 payout ${gain(2)} != ${expect[0]}`);
  if (gain(0) !== expect[1]) throw new Error(`rank2 payout ${gain(0)} != ${expect[1]}`);
  if (gain(3) !== expect[2]) throw new Error(`rank3 payout ${gain(3)} != ${expect[2]}`);
  if (gain(1) !== 0n) throw new Error(`rank4 should get 0, got ${gain(1)}`);
  if (await tokenBal(mp) !== 0n) throw new Error("vault not emptied");

  const m = decodeMatch(Uint8Array.from((await readAccount(mp))!.data))!;
  if (m.state !== STATE.SETTLED) throw new Error("match not SETTLED");

  // Double settle must fail.
  try {
    await signAndSend(settlement, [settleMatchIx(settlement.publicKey, matchId, hash, rankings, winners)]);
    throw new Error("double settle should have failed");
  } catch (e) {
    if (String(e).includes("should have failed")) throw e;
    log("  double settlement rejected ✓");
  }

  // Reclaim on a settled match must fail.
  try {
    await signAndSend(players[0]!, [reclaimEntryIx(players[0]!.publicKey, matchId)]);
    throw new Error("reclaim after settle should have failed");
  } catch (e) {
    if (String(e).includes("should have failed")) throw e;
    log("  reclaim-after-settle rejected ✓");
  }

  log("");
  log("TESTNET E2E PASSED — real escrow, exact 70/20/10 payout, replay+refund guards");
}

run().catch((e) => { console.error("E2E FAILED:", e?.message ?? e); process.exit(1); });
