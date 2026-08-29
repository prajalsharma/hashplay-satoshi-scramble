/**
 * BIP-322 "simple" over a P2TR key — the signature scheme Arch verifies.
 * Sign path VERIFIED live against testnet (accepted first try, sibling
 * project, 2026-08-28). Verify path is new: the realtime server uses it to
 * bind a WebSocket session to a wallet pubkey without any extra wallet API.
 */

import * as btc from "@scure/btc-signer";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes } from "@noble/hashes/utils.js";

const TAG = "BIP0322-signed-message";

function taggedHash(msg: Uint8Array): Uint8Array {
  const t = sha256(new TextEncoder().encode(TAG));
  return sha256(concatBytes(t, t, msg));
}

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

/** to_spend txid (raw sha256d bytes) for message+script. */
function toSpendTxid(messageHash32: Uint8Array, script: Uint8Array): Uint8Array {
  const scriptSig = concatBytes(Uint8Array.of(0x00, 0x20), messageHash32);
  const ser = concatBytes(
    u32le(0), Uint8Array.of(1), new Uint8Array(32), u32le(0xffffffff),
    Uint8Array.of(scriptSig.length), scriptSig, u32le(0),
    Uint8Array.of(1), new Uint8Array(8), Uint8Array.of(script.length), script,
    u32le(0),
  );
  return sha256(sha256(ser));
}

function buildToSign(challenge: Uint8Array, xOnlyPubkey: Uint8Array): { tx: btc.Transaction; script: Uint8Array } {
  const payment = btc.p2tr(xOnlyPubkey, undefined, undefined, true);
  const script = payment.script;
  const spendTxid = toSpendTxid(taggedHash(challenge), script);
  const tx = new btc.Transaction({ version: 0, allowUnknownOutputs: true, allowUnknownInputs: true });
  tx.addInput({
    txid: Uint8Array.from(spendTxid).reverse(), // display-order in, raw on wire
    index: 0,
    sequence: 0,
    witnessUtxo: { script, amount: 0n },
    tapInternalKey: xOnlyPubkey,
  });
  tx.addOutput({ script: Uint8Array.of(0x6a), amount: 0n });
  return { tx, script };
}

/** Sign a challenge with a raw secret key → 64-byte Schnorr signature. */
export function signChallengeBip322(
  secretKey: Uint8Array,
  xOnlyPubkey: Uint8Array,
  challenge: Uint8Array,
): Uint8Array {
  const { tx } = buildToSign(challenge, xOnlyPubkey);
  tx.signIdx(secretKey, 0, [btc.SigHash.DEFAULT]);
  tx.finalizeIdx(0);
  const sig = tx.getInput(0)?.finalScriptWitness?.[0];
  if (!sig || (sig.length !== 64 && sig.length !== 65)) {
    throw new Error(`BIP-322 signing produced no 64-byte signature (${sig?.length})`);
  }
  return sig.length === 65 ? sig.slice(0, 64) : sig;
}

/** Verify a 64-byte Schnorr sig over `challenge` for an x-only pubkey. */
export function verifyChallengeBip322(
  xOnlyPubkey: Uint8Array,
  challenge: Uint8Array,
  sig64: Uint8Array,
): boolean {
  try {
    if (sig64.length !== 64 || xOnlyPubkey.length !== 32) return false;
    const { tx, script } = buildToSign(challenge, xOnlyPubkey);
    const sighash = tx.preimageWitnessV1(0, [script], btc.SigHash.DEFAULT, [0n]);
    // Keyspend signs with the TWEAKED key — it IS the p2tr script's 32 bytes
    // after OP_1 PUSH32 (script = 0x51 0x20 <tweaked>).
    const tweaked = script.slice(2, 34);
    return schnorr.verify(sig64, sighash, tweaked);
  } catch {
    return false;
  }
}
