/**
 * Arch JSON-RPC — the exact method set VERIFIED live (docs/ARCH_VERIFICATION.md).
 */

import { ARCH_RPC_URL } from "./config";

let rpcId = 0;

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(ARCH_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message ?? "rpc error"}`);
  return json.result as T;
}

export const getBestFinalizedBlockHash = () =>
  rpc<string>("get_best_finalized_block_hash", []);

/** Native airdrop (gas): funds ANY pubkey, permissionless — VERIFIED. */
export const requestAirdrop = (pubkey: Uint8Array) =>
  rpc<string>("request_airdrop", Array.from(pubkey));

export type RawAccount = { lamports: number; owner: number[]; data: number[] };

export async function readAccount(pubkey: Uint8Array): Promise<RawAccount | null> {
  try {
    return await rpc<RawAccount>("read_account_info", Array.from(pubkey));
  } catch {
    return null;
  }
}

export const sendTransaction = (tx: unknown) => rpc<string>("send_transaction", tx);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getProcessedTransaction = (txid: string) => rpc<any>("get_processed_transaction", txid);

export const getProgramAccounts = (programId: Uint8Array) =>
  rpc<{ pubkey: number[]; account: { data: number[] } }[]>("get_program_accounts", [
    Array.from(programId),
    null,
  ]);

/** Normalize the observed status shapes: "Processed" | {type} | {Failed}. */
export function normalizeStatus(status: unknown): string {
  if (status == null) return "";
  if (typeof status === "string") return status.toLowerCase();
  if (typeof status === "object") {
    const obj = status as Record<string, unknown>;
    for (const f of ["type", "status", "state"]) {
      if (typeof obj[f] === "string") return (obj[f] as string).toLowerCase();
    }
    const keys = Object.keys(obj);
    if (keys.length === 1) return keys[0]!.toLowerCase();
  }
  return String(status).toLowerCase();
}

export class TxFailedError extends Error {
  constructor(public readonly reason: string, public readonly txid: string) {
    super(`transaction failed on-chain: ${reason}`);
  }
}

export async function waitProcessed(txid: string, attempts = 40, intervalMs = 1200): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const p = await getProcessedTransaction(txid);
      if (p?.status !== undefined) {
        const s = normalizeStatus(p.status);
        if (["processed", "finalized", "confirmed"].includes(s)) return;
        if (s === "failed" || s === "error") {
          const obj = p.status as Record<string, unknown>;
          const reason = typeof obj === "object" && obj
            ? String((obj as any).message ?? (obj as any).Failed ?? JSON.stringify(obj))
            : String(p.status);
          throw new TxFailedError(reason, txid);
        }
      }
    } catch (e) {
      if (e instanceof TxFailedError) throw e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`timed out waiting for ${txid.slice(0, 12)}…`);
}

/** Fund gas (7–50s faucet latency observed). */
export async function ensureGas(pubkey: Uint8Array, min = 200_000, onWait?: () => void): Promise<void> {
  const acct = await readAccount(pubkey);
  if (acct && acct.lamports >= min) return;
  onWait?.();
  await requestAirdrop(pubkey);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const a = await readAccount(pubkey);
    if (a && a.lamports >= min) return;
  }
  throw new Error("gas faucet did not land in time");
}
