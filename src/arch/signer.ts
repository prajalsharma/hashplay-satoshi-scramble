/**
 * ArchSigner — one interface over every supported signer (docs/WALLETS.md).
 * Arch Wallet extension path human-VERIFIED with real funds (sibling, 08-28);
 * local-key path chain-VERIFIED; other extensions implemented per their docs
 * and marked HUMAN TEST REQUIRED until someone completes one.
 */

import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { signChallengeBip322 } from "./bip322";

export type WalletKind = "arch" | "unisat" | "xverse" | "phantom" | "leather";
export type SignerKind = "local" | WalletKind;

export type ArchSigner = {
  kind: SignerKind;
  label: string;
  publicKey: Uint8Array; // x-only 32B — the Arch identity
  publicKeyHex: string;
  address?: string;
  /** Sign a 32-byte Arch transaction message hash (challenge = its 64-hex UTF-8). */
  sign: (challenge: Uint8Array) => Promise<Uint8Array>;
  /**
   * Sign a READABLE login message (SIWE-style). Distinct from `sign`: it goes
   * through the wallet's message-signing UI over human text, so it can never
   * be mistaken for — or replayed as — a transaction signature.
   */
  signLogin: (message: string) => Promise<Uint8Array>;
};

export const WALLET_LABELS: Record<WalletKind, string> = {
  arch: "Arch Wallet", unisat: "UniSat", xverse: "Xverse",
  phantom: "Phantom", leather: "Leather",
};

const hexToBytes32 = (hex: string): Uint8Array => {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** Local raw-key signer (tests, scripts, server settlement key). */
export function localSigner(secretKey: Uint8Array, label = "local"): ArchSigner {
  const publicKey = schnorr.getPublicKey(secretKey);
  return {
    kind: "local", label, publicKey, publicKeyHex: bytesToHex(publicKey),
    sign: async (c) => signChallengeBip322(secretKey, publicKey, c),
    signLogin: async (msg) => signChallengeBip322(secretKey, publicKey, new TextEncoder().encode(msg)),
  };
}

/** Some wallets return signatures base64-encoded, some hex — accept both. */
function anySigToBytes(sig: string | Uint8Array): Uint8Array {
  if (sig instanceof Uint8Array) return sig;
  if (/^[0-9a-f]+$/i.test(sig) && sig.length % 2 === 0 && sig.length >= 128) {
    const out = new Uint8Array(sig.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(sig.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  return base64ToBytes(sig);
}

// ---------------------------------------------------------------------------
// Browser wallet detection (retried — extensions inject late)
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

export function detectWallets(): WalletKind[] {
  if (typeof window === "undefined") return [];
  const w = window as any;
  const found: WalletKind[] = [];
  if (w.arch?.isArchWallet || w.bitcoinArch?.isArchWallet) found.push("arch");
  if (w.unisat) found.push("unisat");
  if (w.XverseProviders?.BitcoinProvider || w.BitcoinProvider) found.push("xverse");
  if (w.phantom?.bitcoin?.isPhantom) found.push("phantom");
  if (w.LeatherProvider) found.push("leather");
  return found;
}

function archProvider(): any {
  const w = window as any;
  return w.arch?.isArchWallet ? w.arch : w.bitcoinArch?.isArchWallet ? w.bitcoinArch : null;
}

export async function disconnectWallet(kind: SignerKind): Promise<void> {
  if (kind !== "arch") return;
  try { await archProvider()?.disconnect?.(); } catch { /* local logout regardless */ }
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58To32(s: string): string {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("malformed base58");
    n = n * 58n + BigInt(i);
  }
  const hex = n.toString(16).padStart(64, "0");
  if (hex.length !== 64) throw new Error("not 32 bytes");
  return hex;
}

function toXOnlyHex(pubkeyHex: string): string {
  const hex = pubkeyHex.trim().toLowerCase().replace(/^0x/, "");
  if (hex.length === 66) return hex.slice(2);
  if (hex.length === 64) return hex;
  throw new Error(`unexpected pubkey length ${hex.length}`);
}

function isTaproot(addr: string): boolean {
  return addr.startsWith("bc1p") || addr.startsWith("tb1p");
}

const challengeToHexString = (challenge: Uint8Array): string => {
  const s = new TextDecoder().decode(challenge).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(s)) throw new Error("unexpected challenge format");
  return s;
};

// ---- BIP-322 witness blob → 64B sig (witness-parsed, proven approach) ------

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function readCompact(bytes: Uint8Array, o: number): { v: number; next: number } | null {
  if (o >= bytes.length) return null;
  const f = bytes[o]!;
  if (f < 0xfd) return { v: f, next: o + 1 };
  if (f === 0xfd && o + 3 <= bytes.length) return { v: bytes[o + 1]! | (bytes[o + 2]! << 8), next: o + 3 };
  return null;
}

export function extractSchnorr(raw: Uint8Array): Uint8Array {
  const count = readCompact(raw, 0);
  if (count && count.v > 0 && count.v <= 16) {
    let o = count.next;
    const items: Uint8Array[] = [];
    for (let i = 0; i < count.v; i++) {
      const size = readCompact(raw, o);
      if (!size || size.next + size.v > raw.length) break;
      items.push(raw.slice(size.next, size.next + size.v));
      o = size.next + size.v;
    }
    if (o === raw.length && items.length) {
      if (items.length >= 2) {
        throw new Error("Not a Taproot signature — switch the wallet to a P2TR address");
      }
      const it = items[0]!;
      if (it.length === 64) return it;
      if (it.length === 65) return it.slice(0, 64);
    }
  }
  if (raw.length === 64) return raw;
  if (raw.length === 65) return raw.slice(0, 64);
  if (raw.length === 66) return raw.slice(2);
  throw new Error(`could not extract 64-byte signature (${raw.length}B)`);
}

const hexSigTo64 = (sigHex: string): Uint8Array => {
  if (!/^[0-9a-f]{128}$/i.test(sigHex)) throw new Error("unexpected signature format");
  const out = new Uint8Array(64);
  for (let i = 0; i < 64; i++) out[i] = parseInt(sigHex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------

export async function connectWallet(kind: WalletKind): Promise<ArchSigner> {
  const w = window as any;

  if (kind === "arch") {
    const p = archProvider();
    if (!p) throw new Error("Arch Wallet extension not found");
    const acct = await p.connect();
    const archAddress: string = acct?.archAddress ?? "";
    if (!archAddress) throw new Error("Arch Wallet returned no Arch address");
    const pubkeyHex = base58To32(archAddress);
    return {
      kind: "arch",
      label: `ARCH WALLET ${archAddress.slice(0, 5)}…${archAddress.slice(-4)}`,
      address: acct?.address,
      publicKey: hexToBytes32(pubkeyHex),
      publicKeyHex: pubkeyHex,
      sign: async (challenge) => {
        const raw = hexToBytes32(challengeToHexString(challenge));
        const res = await p.signArchMessageHash(raw);
        return hexSigTo64(String(res?.signature64Hex ?? ""));
      },
      signLogin: async (msg) => {
        // Message signing (readable) — NOT signArchMessageHash. Cannot be a tx.
        const res = await p.signMessage(new TextEncoder().encode(msg));
        return extractSchnorr(anySigToBytes(res?.signature ?? res));
      },
    };
  }

  if (kind === "unisat") {
    const accounts: string[] = await w.unisat.requestAccounts();
    const address = accounts?.[0];
    if (!address) throw new Error("UniSat returned no account");
    if (!isTaproot(address)) throw new Error("Switch UniSat to a Taproot (P2TR) address");
    const pubkeyHex = toXOnlyHex(await w.unisat.getPublicKey());
    return {
      kind: "unisat", label: `UNISAT ${address.slice(0, 6)}…${address.slice(-4)}`,
      address, publicKey: hexToBytes32(pubkeyHex), publicKeyHex: pubkeyHex,
      sign: async (challenge) =>
        extractSchnorr(base64ToBytes(await w.unisat.signMessage(challengeToHexString(challenge), "bip322-simple"))),
      signLogin: async (msg) =>
        extractSchnorr(base64ToBytes(await w.unisat.signMessage(msg, "bip322-simple"))),
    };
  }

  if (kind === "xverse") {
    const provider = w.XverseProviders?.BitcoinProvider ?? w.BitcoinProvider;
    if (!provider) throw new Error("Xverse provider not found");
    const res = await provider.request("getAccounts", {
      purposes: ["ordinals", "payment"], message: "Connect to Satoshi Scramble",
    });
    const list = res?.result ?? res?.addresses ?? [];
    const acct = list.find((a: any) => a.purpose === "ordinals") ?? list.find((a: any) => isTaproot(a.address ?? ""));
    if (!acct?.address || !acct.publicKey) throw new Error("Xverse returned no Taproot account");
    const address = acct.address as string;
    const pubkeyHex = toXOnlyHex(acct.publicKey);
    return {
      kind: "xverse", label: `XVERSE ${address.slice(0, 6)}…${address.slice(-4)}`,
      address, publicKey: hexToBytes32(pubkeyHex), publicKeyHex: pubkeyHex,
      sign: async (challenge) => {
        const r = await provider.request("signMessage", {
          address, message: challengeToHexString(challenge), protocol: "BIP322",
        });
        if (r?.status === "error") throw new Error(r.error?.message ?? "Xverse declined");
        const sig = r?.status === "success" ? r.result?.signature : (r?.result?.signature ?? r?.signature);
        if (!sig) throw new Error("Xverse returned no signature");
        return extractSchnorr(base64ToBytes(sig));
      },
      signLogin: async (msg) => {
        const r = await provider.request("signMessage", { address, message: msg, protocol: "BIP322" });
        if (r?.status === "error") throw new Error(r.error?.message ?? "Xverse declined");
        const sig = r?.status === "success" ? r.result?.signature : (r?.result?.signature ?? r?.signature);
        if (!sig) throw new Error("Xverse returned no signature");
        return extractSchnorr(base64ToBytes(sig));
      },
    };
  }

  if (kind === "phantom") {
    const btcp = w.phantom?.bitcoin;
    if (!btcp) throw new Error("Phantom Bitcoin provider not found");
    const accounts = await btcp.requestAccounts();
    const acct = accounts?.find((a: any) => a.addressType === "p2tr" || isTaproot(a.address ?? ""));
    if (!acct?.address || !acct.publicKey) throw new Error("Phantom returned no Taproot account");
    const address = acct.address as string;
    const pubkeyHex = toXOnlyHex(typeof acct.publicKey === "string" ? acct.publicKey : bytesToHex(acct.publicKey));
    return {
      kind: "phantom", label: `PHANTOM ${address.slice(0, 6)}…${address.slice(-4)}`,
      address, publicKey: hexToBytes32(pubkeyHex), publicKeyHex: pubkeyHex,
      sign: async (challenge) => {
        const { signature } = await btcp.signMessage(address, new TextEncoder().encode(challengeToHexString(challenge)));
        return extractSchnorr(signature instanceof Uint8Array ? signature : base64ToBytes(String(signature)));
      },
      signLogin: async (msg) => {
        const { signature } = await btcp.signMessage(address, new TextEncoder().encode(msg));
        return extractSchnorr(signature instanceof Uint8Array ? signature : base64ToBytes(String(signature)));
      },
    };
  }

  // leather
  const provider = w.LeatherProvider;
  if (!provider) throw new Error("Leather provider not found");
  const res = await provider.request("getAddresses");
  const list = res?.result?.addresses ?? [];
  const acct = list.find((a: any) => a.type === "p2tr") ?? list.find((a: any) => isTaproot(a.address ?? ""));
  if (!acct?.address || !acct.publicKey) throw new Error("Leather returned no Taproot account");
  const address = acct.address as string;
  const pubkeyHex = toXOnlyHex(acct.publicKey);
  return {
    kind: "leather", label: `LEATHER ${address.slice(0, 6)}…${address.slice(-4)}`,
    address, publicKey: hexToBytes32(pubkeyHex), publicKeyHex: pubkeyHex,
    sign: async (challenge) => {
      const r = await provider.request("signMessage", {
        message: challengeToHexString(challenge), paymentType: "p2tr",
      });
      const sig = r?.result?.signature;
      if (!sig) throw new Error("Leather returned no signature");
      return extractSchnorr(base64ToBytes(sig));
    },
    signLogin: async (msg) => {
      const r = await provider.request("signMessage", { message: msg, paymentType: "p2tr" });
      const sig = r?.result?.signature;
      if (!sig) throw new Error("Leather returned no signature");
      return extractSchnorr(base64ToBytes(sig));
    },
  };
}
