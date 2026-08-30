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
  // Idempotent: if this match PDA already exists (a join race, or a retry after
  // the server restarted mid-cycle), reuse it instead of a create that fails
  // with "an account with the same address already exists".
  if (await readMatch(matchId)) {
    console.log(`[chain] match ${matchId} already on-chain — reusing`);
    return "existing";
  }
  try {
    const txid = await signAndSend(s, [
      createAtaIdempotentIx(s.publicKey, mp),
      createMatchIx(s.publicKey, matchId, maxPlayers),
    ]);
    console.log(`[chain] match ${matchId} created (${txid.slice(0, 10)}…)`);
    return txid;
  } catch (e) {
    // Lost a create race — the other writer already made it; that's success.
    if (/already exists/i.test(e instanceof Error ? e.message : String(e))) {
      console.log(`[chain] match ${matchId} created concurrently — reusing`);
      return "existing";
    }
    throw e;
  }
}

export async function readMatch(matchId: bigint): Promise<OnChainMatch | null> {
  const acct = await readAccount(matchPda(matchId));
  return acct ? decodeMatch(Uint8Array.from(acct.data)) : null;
}

export async function settleOnChain(result: CanonicalResult): Promise<{ txid: string; hash: string }> {
  const s = serverSigner();
  await ensureGas(s.publicKey, 300_000); // never fail settlement for lack of native balance
  const hash = resultHash(result);
  console.log(
    `[chain] settling match ${result.matchId}: hash=${hash.slice(0, 16)}… bytes=${encodeResult(result).length}`,
  );
  const joined = result.players.length;

  // CRITICAL: the program pays m.players[rankings[k]] using the ON-CHAIN join
  // order. The server's joinOrder (confirmReady order) can differ from that when
  // two joins land near-simultaneously, which would make verify_player_ata
  // revert the whole settlement (funds stranded until reclaim). So remap rankings
  // and winners into the on-chain m.players order read back from the match.
  const m = await readMatch(result.matchId);
  if (!m) throw new Error(`match ${result.matchId} not found on-chain`);
  const chainOrder = m.players.slice(0, joined); // hex ids, on-chain slot order
  const rankedIds = result.rankings.map((idx) => result.players[idx]!.id);
  const chainRankings = rankedIds.map((id) => chainOrder.indexOf(id));
  if (chainRankings.some((r) => r < 0)) {
    throw new Error("a ranked player is missing from the on-chain match — refusing to settle");
  }
  const payoutCount = joined >= 4 ? Math.min(3, joined) : 1;
  const winners = chainRankings.slice(0, payoutCount).map((ci) => chainOrder[ci]!);

  // Retry a transient failure — settlement must not strand funds on a blip.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const txid = await signAndSend(
        s,
        [settleMatchIx(s.publicKey, result.matchId, hash, chainRankings, winners)],
      );
      return { txid, hash };
    } catch (e) {
      lastErr = e;
      // A real terminal state (already settled/refunded) must not be retried.
      if (/already|settled|refund|0x0\b|0x12\b/i.test(e instanceof Error ? e.message : String(e))) throw e;
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
  throw lastErr;
}

export const newNonceHex = (): string => randomBytes(32).toString("hex");
export const newTokenHex = (): string => randomBytes(16).toString("hex");
