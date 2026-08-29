/**
 * Arch network configuration — TESTNET ONLY this phase (docs/CONTEXT.md).
 * All endpoints VERIFIED keyless (docs/ARCH_VERIFICATION.md).
 */

export const ARCH_RPC_URL =
  (import.meta as any).env?.VITE_ARCH_RPC_URL?.trim?.() ||
  (typeof process !== "undefined" ? process.env?.ARCH_RPC_URL : undefined) ||
  "https://rpc.testnet.arch.network";

export const ARCH_INDEXER_URL =
  (import.meta as any).env?.VITE_ARCH_INDEXER_URL?.trim?.() ||
  (typeof process !== "undefined" ? process.env?.ARCH_INDEXER_URL : undefined) ||
  "https://explorer.arch.network/api/v1/testnet";

/** scramble program (hex). Filled after deploy; env override for instances. */
export const SCRAMBLE_PROGRAM_ID_HEX: string =
  (import.meta as any).env?.VITE_SCRAMBLE_PROGRAM_ID?.trim?.() ||
  (typeof process !== "undefined" ? process.env?.SCRAMBLE_PROGRAM_ID : undefined) ||
  "";

/** Official testnet aBTC ("Arch BTC"), 8 decimals — docs/ASSET_MODEL.md. */
export const ASSET_MINT_HEX: string =
  (import.meta as any).env?.VITE_SCRAMBLE_ASSET_MINT?.trim?.() ||
  (typeof process !== "undefined" ? process.env?.SCRAMBLE_ASSET_MINT : undefined) ||
  "1d46e0dd87393236e4e01252439f46dcbaec7c2255d1fd734e61771a00e8f4e9";

export const GAME_WS_URL: string =
  (import.meta as any).env?.VITE_GAME_WS_URL?.trim?.() || "ws://127.0.0.1:8890";

export const NETWORK_LABEL = "ARCH TESTNET";

/** 10_000 → "0.0001 aBTC" (8 decimals). Display only — math stays bigint. */
export function formatAsset(baseUnits: bigint): string {
  const neg = baseUnits < 0n;
  const abs = neg ? -baseUnits : baseUnits;
  const whole = abs / 100_000_000n;
  const frac = (abs % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""} aBTC`;
}

export const explorerTxUrl = (txid: string): string =>
  `https://explorer.arch.network/transactions/${txid}?network=testnet`;
