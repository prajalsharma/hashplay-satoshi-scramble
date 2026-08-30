/**
 * Realtime protocol v1 — explicit, validated messages only.
 * Every client message carries the session token issued at hello-auth;
 * nothing a client sends mutates state directly (docs/ARCHITECTURE.md).
 */

import type { LootKind, MatchPhase } from "./types";

export const PROTOCOL_VERSION = 1;

/**
 * The session sign-in message. READABLE and clearly not a transaction, so a
 * login signature can never be replayed as a transaction signature (a tx
 * challenge is a bare 64-hex hash; this is a prefixed human sentence). Both
 * client and server derive it identically from the server's nonce.
 */
export const loginMessage = (nonceHex: string): string =>
  `Satoshi Scramble — sign in to play\n` +
  `nonce: ${nonceHex}\n` +
  `This proves you own this wallet. It authorizes NO transfer.`;

// ---- client → server -------------------------------------------------------

export type ClientMsg =
  | { c: "hello"; pubkey: string; alias: string }
  | { c: "auth"; sig64Hex: string } // signs the server's nonce (BIP-322)
  | { c: "join_room"; room: string }
  | { c: "set_ready"; ready: boolean } // pre-stake "I'm in" green light
  | { c: "chat"; text: string }
  | { c: "ready" }
  | { c: "input"; seq: number; mask: number }
  | { c: "ping"; t: number }
  | { c: "resume"; resumeToken: string };

export function parseClientMsg(raw: unknown): ClientMsg | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  let m: unknown;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m !== "object") return null;
  const o = m as Record<string, unknown>;
  switch (o.c) {
    case "hello":
      return /^[0-9a-f]{64}$/.test(String(o.pubkey)) && typeof o.alias === "string" && o.alias.length <= 20
        ? { c: "hello", pubkey: String(o.pubkey), alias: String(o.alias) } : null;
    case "auth":
      return /^[0-9a-f]{128}$/.test(String(o.sig64Hex)) ? { c: "auth", sig64Hex: String(o.sig64Hex) } : null;
    case "join_room":
      return /^[A-Z0-9-]{1,16}$/.test(String(o.room)) ? { c: "join_room", room: String(o.room) } : null;
    case "set_ready":
      return { c: "set_ready", ready: Boolean(o.ready) };
    case "chat": {
      const text = String(o.text ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
      return text ? { c: "chat", text } : null;
    }
    case "ready":
      return { c: "ready" };
    case "input": {
      const seq = Number(o.seq), mask = Number(o.mask);
      return Number.isInteger(seq) && seq >= 0 && Number.isInteger(mask) && (mask & ~0b1111) === 0
        ? { c: "input", seq, mask } : null;
    }
    case "ping":
      return Number.isFinite(Number(o.t)) ? { c: "ping", t: Number(o.t) } : null;
    case "resume":
      return /^[0-9a-f]{32}$/.test(String(o.resumeToken)) ? { c: "resume", resumeToken: String(o.resumeToken) } : null;
    default:
      return null;
  }
}

// ---- server → client -------------------------------------------------------

export type RoomInfo = {
  room: string;
  players: number;
  capacity: number;
  entryBaseUnits: string;
  state: MatchPhase | "waiting";
  matchId: string | null;
};

export type PlayerSnap = {
  id: string; alias: string; x: number; y: number; vx: number; vy: number;
  carrying: string; banked: string; immunity: number; connected: boolean;
};

export type LootSnap = { id: number; kind: LootKind; x: number; y: number };

export type ServerMsg =
  | { s: "challenge"; nonceHex: string; protocol: number }
  | { s: "welcome"; playerId: string; resumeToken: string }
  | { s: "rooms"; rooms: RoomInfo[] }
  | { s: "room_state"; room: RoomInfo; players: { id: string; alias: string; joined: boolean; ready: boolean }[] }
  | { s: "chat"; from: string; alias: string; text: string; ts: number }
  | { s: "join_ok"; room: string; matchId: string; matchPda: string }
  | { s: "snapshot"; phase: MatchPhase; timeLeft: number; players: PlayerSnap[]; loot: LootSnap[]; tick: number }
  | { s: "tick"; tick: number; timeLeft: number; moved: [string, number, number, number, number][]; events: unknown[] }
  | { s: "leaderboard"; rows: { id: string; alias: string; banked: string; rank: number }[] }
  | { s: "match_start"; matchId: string }
  | { s: "match_end"; rankings: { id: string; alias: string; banked: string; rank: number }[]; resultHash: string }
  | { s: "settlement"; state: "pending" | "submitted" | "confirmed" | "failed"; txid?: string; payouts?: { id: string; amount: string }[] }
  | { s: "pong"; t: number }
  | { s: "error"; code: string; message: string };

export const enc = (m: ServerMsg | ClientMsg): string => JSON.stringify(m);
