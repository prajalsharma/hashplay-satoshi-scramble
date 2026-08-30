/**
 * One-time on-chain config init for a deployed scramble program — no minting,
 * no players (unlike testnet-e2e). Run once after deploy so join_match stops
 * failing with NotInitialized (custom program error 0x1).
 *
 *   SCRAMBLE_PROGRAM_ID=<hex> server/node_modules/.bin/tsx scripts/init-config.mts
 *
 * The authority (and settlement authority) is programs/scramble/.deploy-authority.json,
 * the same key pinned into the program at build and used by the server.
 */

import { readFileSync } from "node:fs";
import { localSigner, type ArchSigner } from "../src/arch/signer.ts";
import { ensureGas, readAccount } from "../src/arch/rpc.ts";
import { signAndSend } from "../src/arch/txSend.ts";
import { configPda, initConfigIx, mintPk } from "../src/arch/program.ts";
import { bytesToHex } from "@noble/hashes/utils.js";
import { ENTRY_BASE_UNITS, JOIN_TIMEOUT_SECS, SETTLE_TIMEOUT_SECS } from "../src/shared/constants.ts";

const log = (s: string) => console.log(s);

function keyFromFile(path: string, label: string): ArchSigner {
  const s = readFileSync(path, "utf8").trim();
  const sk = /^[0-9a-f]{64}$/i.test(s)
    ? Uint8Array.from(Buffer.from(s, "hex"))
    : Uint8Array.from(JSON.parse(s) as number[]).slice(0, 32);
  return localSigner(sk, label);
}

async function main(): Promise<void> {
  if (!process.env.SCRAMBLE_PROGRAM_ID) throw new Error("set SCRAMBLE_PROGRAM_ID=<hex>");
  const authority = keyFromFile(
    process.env.SCRAMBLE_AUTHORITY_FILE ?? "programs/scramble/.deploy-authority.json",
    "authority",
  );
  log(`program ${process.env.SCRAMBLE_PROGRAM_ID.slice(0, 12)}… asset ${bytesToHex(mintPk()).slice(0, 12)}…`);

  const existing = await readAccount(configPda());
  if (existing && existing.data.length > 0) {
    log("config already initialized ✓ — nothing to do");
    return;
  }

  log("funding authority gas…");
  await ensureGas(authority.publicKey, 300_000, () => log("  faucet…"));

  log("init_config…");
  try {
    await signAndSend(authority, [
      initConfigIx(authority.publicKey, authority.publicKey, ENTRY_BASE_UNITS, JOIN_TIMEOUT_SECS, SETTLE_TIMEOUT_SECS),
    ]);
  } catch (e) {
    // 0x0 = AlreadyInitialized; a poll timeout can also hide a landed tx.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/0x0|already ?initial|timed out/i.test(msg)) throw e;
    log(`(init returned "${msg}" — verifying on-chain state instead)`);
  }

  const after = await readAccount(configPda());
  if (after && after.data.length > 0) log("config initialized ✓ — join_match will work now");
  else throw new Error("init sent but config account still empty — check RPC/authority");
}

main().catch((e) => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
