/**
 * Canonical SCRAMBLE_V1 match result — deterministic byte encoding, no JSON.
 * Layout: "SCRAMBLE_V1" ‖ matchId u64LE ‖ entry u64LE ‖ n u8 ‖
 *         n × (pubkey 32B ‖ banked u64LE) [join order] ‖ n × rank-index u8 ‖
 *         startTs u64LE ‖ endTs u64LE   →  SHA-256 = MATCH_RESULT_HASH.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { RULESET_VERSION } from "./constants";
import type { CanonicalResult } from "./types";

const u64le = (n: bigint): Uint8Array => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
};

const hexToBytes32 = (hex: string): Uint8Array => {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

export function encodeResult(r: CanonicalResult): Uint8Array {
  if (r.ruleset !== RULESET_VERSION) throw new Error("ruleset mismatch");
  const parts: Uint8Array[] = [
    new TextEncoder().encode(r.ruleset),
    u64le(r.matchId),
    u64le(r.entry),
    Uint8Array.of(r.players.length),
  ];
  for (const p of r.players) {
    parts.push(hexToBytes32(p.id), u64le(p.banked));
  }
  parts.push(Uint8Array.from(r.rankings));
  parts.push(u64le(BigInt(r.startTs)), u64le(BigInt(r.endTs)));
  const total = parts.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export const resultHash = (r: CanonicalResult): string =>
  bytesToHex(sha256(encodeResult(r)));
