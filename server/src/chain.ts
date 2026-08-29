/**
 * Server-side chain operations: the settlement authority creates matches,
 * verifies joins by reading match accounts, and settles with the canonical
 * result. Uses the same verified pipeline as the client (../../src/arch).
 */

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { localSigner, type ArchSigner } from "../../src/arch/signer";
import { ensureGas, readAccount } from "../../src/arch/rpc";
import { signAndSend } from "../../src/arch/txSend";
import {
  createAtaIdempotentIx, createMatchIx, decodeMatch, matchPda,
  settleMatchIx, type OnChainMatch,
} from "../../src/arch/program";
import { encodeResult, resultHash } from "../../src/shared/result";
import type { CanonicalResult } from "../../src/shared/types";

let signer: ArchSigner | null = null;

export function serverSigner(): ArchSigner {
  if (signer) return signer;
  const hexEnv = process.env.SERVER_SIGNING_PRIVATE_KEY?.trim();
  const file = process.env.SERVER_SIGNING_KEY_FILE?.trim();
  let secret: Uint8Array;
  if (hexEnv && /^[0-9a-f]{64}$/i.test(hexEnv)) {
    secret = Uint8Array.from(Buffer.from(hexEnv, "hex"));
  } else if (file) {
    const content = readFileSync(file, "utf8").trim();
    secret = /^[0-9a-f]{64}$/i.test(content)
      ? Uint8Array.from(Buffer.from(content, "hex"))
      : Uint8Array.from(JSON.parse(content) as number[]).slice(0, 32);
  } else {
    throw new Error("SERVER_SIGNING_PRIVATE_KEY or SERVER_SIGNING_KEY_FILE required in live mode");
  }
  signer = localSigner(secret, "settlement-authority");
  return signer;
}

export const chainEnabled = (): boolean =>
  Boolean(process.env.SCRAMBLE_PROGRAM_ID?.trim());

export async function ensureServerFunded(): Promise<void> {
  await ensureGas(serverSigner().publicKey, 300_000, () =>
    console.log("[chain] funding settlement authority gas via airdrop…"),
  );
}

export async function createMatchOnChain(matchId: bigint, maxPlayers: number): Promise<string> {
  const s = serverSigner();
  const mp = matchPda(matchId);
  const txid = await signAndSend(s, [
    createAtaIdempotentIx(s.publicKey, mp),
    createMatchIx(s.publicKey, matchId, maxPlayers),
  ]);
  console.log(`[chain] match ${matchId} created (${txid.slice(0, 10)}…)`);
  return txid;
}

export async function readMatch(matchId: bigint): Promise<OnChainMatch | null> {
  const acct = await readAccount(matchPda(matchId));
  return acct ? decodeMatch(Uint8Array.from(acct.data)) : null;
}

export async function settleOnChain(result: CanonicalResult): Promise<{ txid: string; hash: string }> {
  const s = serverSigner();
  const hash = resultHash(result);
  // Log the canonical bytes length for observability (never secrets).
  console.log(
    `[chain] settling match ${result.matchId}: hash=${hash.slice(0, 16)}… bytes=${encodeResult(result).length}`,
  );
  const joined = result.players.length;
  const payoutCount = joined >= 4 ? Math.min(3, joined) : 1;
  const winners = result.rankings
    .slice(0, payoutCount)
    .map((idx) => result.players[idx]!.id);
  const txid = await signAndSend(
    s,
    [settleMatchIx(s.publicKey, result.matchId, hash, result.rankings, winners)],
  );
  return { txid, hash };
}

export const newNonceHex = (): string => randomBytes(32).toString("hex");
export const newTokenHex = (): string => randomBytes(16).toString("hex");
