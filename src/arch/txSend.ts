/**
 * Build → sign → submit → confirm one Arch transaction. Wire flow VERIFIED
 * live (docs/ARCH_VERIFICATION.md): compile sanitized message, hash (the hash
 * bytes ARE the signing challenge), BIP-322 sign, submit {version:0,…}.
 */

import { SanitizedMessageUtil } from "@arch-network/arch-sdk";
import { getBestFinalizedBlockHash, sendTransaction, waitProcessed } from "./rpc";
import type { ArchSigner } from "./signer";

export type SdkInstruction = {
  program_id: Uint8Array;
  accounts: { pubkey: Uint8Array; is_signer: boolean; is_writable: boolean }[];
  data: Uint8Array;
};

export type TxPhase =
  | "idle" | "preparing" | "signing" | "submitted" | "confirming" | "confirmed" | "failed";
export type TxProgress = { phase: TxPhase; txid?: string; error?: string };

const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

export async function signAndSend(
  signer: ArchSigner,
  instructions: SdkInstruction[],
  onProgress?: (p: TxProgress) => void,
): Promise<string> {
  onProgress?.({ phase: "preparing" });
  const blockhash = hexToBytes(await getBestFinalizedBlockHash());
  const message = SanitizedMessageUtil.createSanitizedMessage(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    instructions as any,
    signer.publicKey,
    blockhash,
  );
  if (typeof message === "string") throw new Error(`failed to compile message: ${message}`);

  onProgress?.({ phase: "signing" });
  const challenge = SanitizedMessageUtil.hash(message);
  const signature = await signer.sign(challenge);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = message as any;
  const txid = await sendTransaction({
    version: 0,
    signatures: [Array.from(signature)],
    message: {
      header: m.header,
      account_keys: m.account_keys.map((k: Uint8Array) => Array.from(k)),
      recent_blockhash: Array.from(m.recent_blockhash),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      instructions: m.instructions.map((ix: any) => ({
        program_id_index: ix.program_id_index,
        accounts: Array.from(ix.accounts),
        data: Array.from(ix.data),
      })),
    },
  });
  onProgress?.({ phase: "confirming", txid });
  await waitProcessed(txid);
  onProgress?.({ phase: "confirmed", txid });
  return txid;
}
