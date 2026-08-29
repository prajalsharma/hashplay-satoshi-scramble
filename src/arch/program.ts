/**
 * scramble program bindings — byte-identical to programs/scramble/src/lib.rs
 * (fixed-width Borsh, u8 enum discriminants, u64/i64 little-endian).
 */

import { PubkeyUtil, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@arch-network/arch-sdk";
import { bytesToHex } from "@noble/hashes/utils.js";
import { ASSET_MINT_HEX, SCRAMBLE_PROGRAM_ID_HEX } from "./config";
import type { SdkInstruction } from "./txSend";

const enc = new TextEncoder();
export const SYSTEM_PROGRAM = new Uint8Array(32);

export const STATE = { OPEN: 0, SETTLED: 1, REFUND: 2 } as const;
export const MATCH_LEN = 333;
export const CONFIG_LEN = 121;

const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

export const programId = (): Uint8Array => {
  if (!SCRAMBLE_PROGRAM_ID_HEX) throw new Error("SCRAMBLE_PROGRAM_ID not configured");
  return PubkeyUtil.fromHex(SCRAMBLE_PROGRAM_ID_HEX);
};
export const mintPk = (): Uint8Array => PubkeyUtil.fromHex(ASSET_MINT_HEX);

const u64le = (n: bigint): Uint8Array => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
};
const i64le = u64le;

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

export function configPda(): Uint8Array {
  return PubkeyUtil.findProgramAddress([enc.encode("config")], programId())[0];
}

export function matchPda(matchId: bigint): Uint8Array {
  return PubkeyUtil.findProgramAddress([enc.encode("match"), u64le(matchId)], programId())[0];
}

export function ataOf(owner: Uint8Array): Uint8Array {
  return PubkeyUtil.getAssociatedTokenAddress(mintPk(), owner, true) as unknown as Uint8Array;
}

const meta = (pubkey: Uint8Array, is_signer: boolean, is_writable: boolean) => ({ pubkey, is_signer, is_writable });

export function createAtaIdempotentIx(funder: Uint8Array, owner: Uint8Array): SdkInstruction {
  return {
    program_id: ASSOCIATED_TOKEN_PROGRAM_ID,
    accounts: [
      meta(funder, true, true),
      meta(ataOf(owner), false, true),
      meta(owner, false, false),
      meta(mintPk(), false, false),
      meta(SYSTEM_PROGRAM, false, false),
      meta(TOKEN_PROGRAM_ID, false, false),
    ],
    data: Uint8Array.of(1),
  };
}

export function initConfigIx(
  authority: Uint8Array,
  settlementAuthority: Uint8Array,
  entry: bigint,
  joinTimeoutSecs: bigint,
  settleTimeoutSecs: bigint,
): SdkInstruction {
  return {
    program_id: programId(),
    accounts: [
      meta(authority, true, true),
      meta(configPda(), false, true),
      meta(mintPk(), false, false),
      meta(settlementAuthority, false, false),
      meta(SYSTEM_PROGRAM, false, false),
    ],
    data: concat(Uint8Array.of(0), u64le(entry), i64le(joinTimeoutSecs), i64le(settleTimeoutSecs)),
  };
}

export function createMatchIx(sa: Uint8Array, matchId: bigint, maxPlayers: number): SdkInstruction {
  const mp = matchPda(matchId);
  return {
    program_id: programId(),
    accounts: [
      meta(sa, true, true),
      meta(configPda(), false, false),
      meta(mp, false, true),
      meta(ataOf(mp), false, true),
      meta(SYSTEM_PROGRAM, false, false),
    ],
    data: concat(Uint8Array.of(1), u64le(matchId), Uint8Array.of(maxPlayers)),
  };
}

export function joinMatchIx(player: Uint8Array, matchId: bigint): SdkInstruction {
  const mp = matchPda(matchId);
  return {
    program_id: programId(),
    accounts: [
      meta(player, true, false),
      meta(configPda(), false, false),
      meta(mp, false, true),
      meta(ataOf(player), false, true),
      meta(ataOf(mp), false, true),
      meta(TOKEN_PROGRAM_ID, false, false),
    ],
    data: Uint8Array.of(2),
  };
}

export function settleMatchIx(
  sa: Uint8Array,
  matchId: bigint,
  resultHashHex: string,
  rankings: number[], // indices, best first, length = joined
  winnerPubkeysHex: string[], // players[rankings[k]] for k in 0..payoutCount
): SdkInstruction {
  const mp = matchPda(matchId);
  const rank8 = new Uint8Array(8);
  rankings.forEach((r, i) => { rank8[i] = r; });
  const accounts = [
    meta(sa, true, false),
    meta(configPda(), false, false),
    meta(mp, false, true),
    meta(ataOf(mp), false, true),
    meta(TOKEN_PROGRAM_ID, false, false),
    ...winnerPubkeysHex.map((h) => meta(ataOf(hexToBytes(h)), false, true)),
  ];
  return {
    program_id: programId(),
    accounts,
    data: concat(Uint8Array.of(3), hexToBytes(resultHashHex), rank8),
  };
}

export function reclaimEntryIx(player: Uint8Array, matchId: bigint): SdkInstruction {
  const mp = matchPda(matchId);
  return {
    program_id: programId(),
    accounts: [
      meta(player, true, false),
      meta(configPda(), false, false),
      meta(mp, false, true),
      meta(ataOf(mp), false, true),
      meta(ataOf(player), false, true),
      meta(TOKEN_PROGRAM_ID, false, false),
    ],
    data: Uint8Array.of(4),
  };
}

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

export type OnChainMatch = {
  matchId: bigint;
  entry: bigint;
  maxPlayers: number;
  joined: number;
  state: number;
  refundClaimed: number;
  createdAt: number;
  joinDeadline: number;
  settleDeadline: number;
  players: string[]; // hex, length = joined
  resultHashHex: string;
};

export function decodeMatch(data: Uint8Array): OnChainMatch | null {
  if (data.length < MATCH_LEN) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // Layout: id(0) entry(8) max(16) joined(17) state(18) refund(19)
  //         created(20) joinDl(28) settleDl(36) players(44..300) hash(300..332) bump(332)
  const joined = data[17]!;
  const players: string[] = [];
  for (let i = 0; i < joined; i++) {
    players.push(bytesToHex(data.slice(44 + i * 32, 44 + i * 32 + 32)));
  }
  return {
    matchId: v.getBigUint64(0, true),
    entry: v.getBigUint64(8, true),
    maxPlayers: data[16]!,
    joined,
    state: data[18]!,
    refundClaimed: data[19]!,
    createdAt: Number(v.getBigInt64(20, true)),
    joinDeadline: Number(v.getBigInt64(28, true)),
    settleDeadline: Number(v.getBigInt64(36, true)),
    resultHashHex: bytesToHex(data.slice(300, 332)),
    players,
  };
}

/** Token-account amount (u64 LE at 64), 0 when missing. */
export function decodeTokenAmount(data: Uint8Array | null): bigint {
  if (!data || data.length < 72) return 0n;
  return new DataView(data.buffer, data.byteOffset).getBigUint64(64, true);
}
