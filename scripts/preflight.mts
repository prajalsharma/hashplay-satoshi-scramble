/**
 * Testnet preflight — fail fast before any deploy/E2E. Checks connectivity,
 * asset, program presence, config, and account funding. Never touches mainnet.
 *
 *   [SCRAMBLE_PROGRAM_ID=<hex>] server/node_modules/.bin/tsx scripts/preflight.mts
 */

import { readFileSync } from "node:fs";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { ARCH_RPC_URL, ARCH_INDEXER_URL, ASSET_MINT_HEX } from "../src/arch/config.ts";

const OK = "✓", NO = "✗";
let hardFail = false;

function line(label: string, ok: boolean | "warn", detail = ""): void {
  const mark = ok === true ? OK : ok === "warn" ? "!" : NO;
  console.log(`  ${mark} ${label}${detail ? " — " + detail : ""}`);
  if (ok === false) hardFail = true;
}

async function rpc<T>(method: string, params: unknown): Promise<T | null> {
  try {
    const r = await fetch(ARCH_RPC_URL, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(10000),
    });
    const j = (await r.json()) as { result?: T; error?: unknown };
    return j.error ? null : (j.result as T);
  } catch { return null; }
}

function pubkeyFromFile(path: string): Uint8Array | null {
  try {
    const s = readFileSync(path, "utf8").trim();
    const sk = /^[0-9a-f]{64}$/i.test(s) ? Uint8Array.from(Buffer.from(s, "hex")) : Uint8Array.from(JSON.parse(s) as number[]).slice(0, 32);
    return schnorr.getPublicKey(sk);
  } catch { return null; }
}

async function lamports(pub: Uint8Array): Promise<number> {
  const a = await rpc<{ lamports: number }>("read_account_info", Array.from(pub));
  return a?.lamports ?? 0;
}

async function main(): Promise<void> {
  console.log("SATOSHI SCRAMBLE — TESTNET PREFLIGHT");
  console.log(`network: ARCH TESTNET · rpc: ${ARCH_RPC_URL}`);

  // Never mainnet.
  line("network is testnet (not mainnet)", !/mainnet/.test(ARCH_RPC_URL), ARCH_RPC_URL);

  const height = await rpc<number>("get_block_count", []);
  line("RPC reachable", height !== null, height !== null ? `block ${height}` : "no response");

  try {
    const r = await fetch(`${ARCH_INDEXER_URL}/tokens/${ASSET_MINT_HEX}`, { signal: AbortSignal.timeout(8000) });
    const j = (await r.json()) as { symbol?: string; decimals?: number };
    line("aBTC asset present", j.decimals === 8, `${j.symbol ?? "?"} · ${j.decimals}dp`);
  } catch { line("aBTC asset present", false, "indexer unreachable"); }

  // Program present?
  const progHex = process.env.SCRAMBLE_PROGRAM_ID?.trim();
  if (progHex) {
    const acct = await rpc<{ owner: number[] }>("read_account_info", Array.from(Buffer.from(progHex, "hex")));
    line("program deployed", acct !== null, progHex.slice(0, 12) + "…");
    // Config initialized?  config PDA is program-owned + non-empty.
    const { configPda } = await import("../src/arch/program.ts");
    process.env.SCRAMBLE_PROGRAM_ID = progHex;
    const cfg = await rpc<{ data: number[] }>("read_account_info", Array.from(configPda()));
    line("config initialized", Boolean(cfg && cfg.data.length > 0), cfg ? `${cfg.data.length}B` : "absent");
  } else {
    line("program deployed", "warn", "SCRAMBLE_PROGRAM_ID unset — deploy step not run yet");
  }

  // Funding.
  const authPub = pubkeyFromFile(process.env.SCRAMBLE_AUTHORITY_FILE ?? "programs/scramble/.deploy-authority.json");
  if (authPub) {
    const lam = await lamports(authPub);
    line(`deploy/settlement authority funded (${bytesToHex(authPub).slice(0, 8)}…)`, lam >= 300_000, `${lam} lamports`);
  } else {
    line("deploy authority key present", false, "programs/scramble/.deploy-authority.json missing");
  }

  // Faucet liveness (informational — the known outage).
  if (authPub && (await lamports(authPub)) < 300_000) {
    const air = await rpc<string>("request_airdrop", Array.from(authPub));
    if (air) {
      let landed = false;
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        if ((await lamports(authPub)) >= 300_000) { landed = true; break; }
      }
      line("native faucet functional", landed ? true : "warn", landed ? "funded" : "airdrop accepted but not landing (known outage) — fund by transfer");
    } else {
      line("native faucet functional", "warn", "airdrop request rejected");
    }
  }

  console.log("");
  if (hardFail) {
    console.log("PREFLIGHT: FAIL — resolve the ✗ items above before deploying.");
    process.exit(1);
  }
  console.log("PREFLIGHT: OK for the checks that don't need funds. See any '!' warnings.");
}

void main();
