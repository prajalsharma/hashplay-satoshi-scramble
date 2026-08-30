/**
 * GameClient — the live-mode wire: challenge-auth, room join, input stream,
 * snapshot/tick ingestion with interpolation for others and prediction for
 * self. UI subscribes via callbacks; the server stays authoritative.
 */

import { GAME_WS_URL } from "../arch/config";
import type { ArchSigner } from "../arch/signer";
import { enc, loginMessage, type RoomInfo, type ServerMsg } from "../shared/protocol";
import { integrateMovement } from "../shared/sim";
import type { View, ViewLoot, ViewPlayer } from "./renderer";

export type NetPhase =
  | "connecting" | "authing" | "rooms" | "joining" | "lobby"
  | "countdown" | "live" | "ended" | "error";

export type NetState = {
  phase: NetPhase;
  rooms: RoomInfo[];
  room: string | null;
  matchId: string | null;
  matchPdaHex: string | null;
  lobbyPlayers: { id: string; alias: string; joined: boolean }[];
  leaderboard: { id: string; alias: string; banked: string; rank: number }[];
  rankings: { id: string; alias: string; banked: string; rank: number }[] | null;
  resultHash: string | null;
  settlement: { state: string; txid?: string } | null;
  error: string | null;
  latencyMs: number | null;
  tick: number;
};

type Remote = { x: number; y: number; px: number; py: number; at: number; prevAt: number };

const RESUME_KEY = "scramble.resume.v1";

export class GameClient {
  private ws: WebSocket | null = null;
  private signer: ArchSigner;
  private alias: string;
  private seq = 0;
  private mask = 0;
  private self: { x: number; y: number; vx: number; vy: number; input: number } | null = null;
  private remotes = new Map<string, Remote>();
  private meta = new Map<string, { alias: string; carrying: bigint; banked: bigint; immunity: number; connected: boolean }>();
  private loot = new Map<number, ViewLoot>();
  private timeLeft = 0;
  private simPhase = "lobby";
  private colorOf = new Map<string, number>();
  private lastFrame = 0;

  state: NetState = {
    phase: "connecting", rooms: [], room: null, matchId: null, matchPdaHex: null,
    lobbyPlayers: [], leaderboard: [], rankings: null, resultHash: null,
    settlement: null, error: null, latencyMs: null, tick: 0,
  };

  constructor(
    signer: ArchSigner,
    alias: string,
    private onState: (s: NetState) => void,
  ) {
    this.signer = signer;
    this.alias = alias;
  }

  private reconnects = 0;
  private stopped = false;
  private authedOnce = false;
  private authInFlight = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  connect(): void {
    const ws = new WebSocket(`${GAME_WS_URL}/ws`);
    this.ws = ws;
    ws.onopen = () => { this.reconnects = 0; this.push({ phase: "connecting" }); };
    ws.onclose = () => this.scheduleReconnect();
    ws.onmessage = (ev) => void this.onMsg(JSON.parse(String(ev.data)) as ServerMsg);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.send(enc({ c: "ping", t: Date.now() }));
    }, 5000);
  }

  /** Explicit teardown so nothing keeps prompting after leaving live mode. */
  close(): void {
    this.stopped = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    try { this.ws?.close(); } catch { /* ignore */ }
  }

  /**
   * Reconnect with capped exponential backoff. On reconnect we ONLY resume via
   * the stored token (no wallet re-sign) — a downed server can never trigger
   * repeated wallet prompts. After the cap, we surface an error and stop.
   */
  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.reconnects >= 6) {
      this.push({ phase: "error", error: "GAME SERVER UNREACHABLE — TRY AGAIN LATER OR USE PRACTICE MODE" });
      return;
    }
    const delay = Math.min(15000, 1500 * 2 ** this.reconnects);
    this.reconnects++;
    this.push({ error: `CONNECTION LOST — RECONNECTING (${this.reconnects}/6)…` });
    setTimeout(() => this.resumeOrReconnect(), delay);
  }

  private resumeOrReconnect(): void {
    if (this.stopped) return;
    const token = sessionStorage.getItem(RESUME_KEY);
    const ws = new WebSocket(`${GAME_WS_URL}/ws`);
    this.ws = ws;
    ws.onmessage = (ev) => void this.onMsg(JSON.parse(String(ev.data)) as ServerMsg);
    // The challenge handler decides: resume via token (no re-sign) if we have
    // a session, else a single fresh sign-in. Nothing to do on open here.
    void token;
    ws.onopen = () => { this.reconnects = 0; };
    ws.onclose = () => this.scheduleReconnect();
  }

  private async onMsg(m: ServerMsg): Promise<void> {
    switch (m.s) {
      case "challenge": {
        // Already have a session? Resume with the token — never re-prompt the
        // wallet on a reconnect. A single sign-in per session, by design.
        const existing = sessionStorage.getItem(RESUME_KEY);
        if (existing && this.authedOnce) {
          this.ws!.send(enc({ c: "resume", resumeToken: existing }));
          return;
        }
        // Never stack a second wallet popup. If a sign-in is already open (e.g.
        // the socket blipped and reconnected while the wallet was still waiting
        // for approval), don't fire another — one popup at a time, period.
        if (this.authInFlight) return;
        this.authInFlight = true;
        this.push({ phase: "authing" });
        this.ws!.send(enc({ c: "hello", pubkey: this.signer.publicKeyHex, alias: this.alias }));
        try {
          // SIWE-style: sign a READABLE login message, never a raw hash. This
          // signature can never be replayed as a transaction (see protocol.ts).
          const sig = await this.signer.signLogin(loginMessage(m.nonceHex));
          if (this.ws && this.ws.readyState === this.ws.OPEN) {
            this.ws.send(enc({ c: "auth", sig64Hex: [...sig].map((b) => b.toString(16).padStart(2, "0")).join("") }));
          }
        } catch (e) {
          this.push({ phase: "error", error: `WALLET DECLINED SIGN-IN — ${(e as Error).message}`.toUpperCase() });
        } finally {
          this.authInFlight = false;
        }
        return;
      }
      case "welcome":
        this.authedOnce = true;
        sessionStorage.setItem(RESUME_KEY, m.resumeToken);
        this.push({ phase: this.state.room ? this.state.phase : "rooms" });
        return;
      case "rooms":
        this.push({ rooms: m.rooms, phase: this.state.phase === "authing" ? "rooms" : this.state.phase });
        return;
      case "room_state":
        this.push({ lobbyPlayers: m.players, rooms: this.state.rooms.map((r) => (r.room === m.room.room ? m.room : r)) });
        return;
      case "join_ok":
        this.push({ room: m.room, matchId: m.matchId, matchPdaHex: m.matchPda || null, phase: "joining" });
        return;
      case "match_start":
        this.push({ phase: "countdown", rankings: null, settlement: null, resultHash: null });
        return;
      case "snapshot": {
        this.simPhase = m.phase;
        this.timeLeft = m.timeLeft;
        this.loot = new Map(m.loot.map((l) => [l.id, l]));
        const now = performance.now();
        for (const p of m.players) {
          if (!this.colorOf.has(p.id)) this.colorOf.set(p.id, this.colorOf.size);
          this.meta.set(p.id, {
            alias: p.alias, carrying: BigInt(p.carrying), banked: BigInt(p.banked),
            immunity: p.immunity, connected: p.connected,
          });
          if (p.id === this.signer.publicKeyHex) {
            if (!this.self) this.self = { x: p.x, y: p.y, vx: p.vx, vy: p.vy, input: this.mask };
            else if (Math.hypot(this.self.x - p.x, this.self.y - p.y) > 1.5) {
              this.self.x = p.x; this.self.y = p.y; // hard resync when far off
            }
          } else {
            this.remotes.set(p.id, { x: p.x, y: p.y, px: p.x, py: p.y, at: now, prevAt: now - 50 });
          }
        }
        this.push({ phase: m.phase === "live" ? "live" : m.phase === "countdown" ? "countdown" : this.state.phase, tick: m.tick });
        return;
      }
      case "tick": {
        this.timeLeft = m.timeLeft;
        const now = performance.now();
        for (const [id, x, y, vx, vy] of m.moved) {
          if (id === this.signer.publicKeyHex) {
            if (this.self) {
              // gentle reconciliation toward the authoritative position
              this.self.x += (x - this.self.x) * 0.25;
              this.self.y += (y - this.self.y) * 0.25;
              this.self.vx = vx; this.self.vy = vy;
              if (Math.hypot(this.self.x - x, this.self.y - y) > 1.5) { this.self.x = x; this.self.y = y; }
            }
            continue;
          }
          const r = this.remotes.get(id);
          if (r) {
            r.px = r.x; r.py = r.y; r.prevAt = r.at;
            r.x = x; r.y = y; r.at = now;
          } else {
            this.remotes.set(id, { x, y, px: x, py: y, at: now, prevAt: now - 50 });
          }
        }
        for (const ev of m.events as { t: string; [k: string]: unknown }[]) {
          if (ev.t === "pickup") {
            this.loot.delete(ev.lootId as number);
            const meta = this.meta.get(ev.player as string);
            if (meta) meta.carrying += BigInt(ev.value as string);
          } else if (ev.t === "loot_spawn") {
            const l = ev.loot as ViewLoot;
            this.loot.set(l.id, l);
          } else if (ev.t === "bank") {
            const meta = this.meta.get(ev.player as string);
            if (meta) { meta.banked = BigInt(ev.banked as string); meta.carrying = 0n; }
          } else if (ev.t === "scatter") {
            const meta = this.meta.get(ev.victim as string);
            if (meta) meta.carrying -= BigInt(ev.dropped as string);
          } else if (ev.t === "phase" && ev.phase === "live") {
            this.push({ phase: "live" });
          }
        }
        this.state.tick = m.tick;
        return;
      }
      case "leaderboard":
        this.push({ leaderboard: m.rows });
        return;
      case "match_end":
        this.push({ phase: "ended", rankings: m.rankings, resultHash: m.resultHash });
        return;
      case "settlement":
        this.push({ settlement: { state: m.state, txid: m.txid } });
        return;
      case "pong":
        this.push({ latencyMs: Date.now() - m.t });
        return;
      case "error":
        this.push({ error: m.message.toUpperCase() });
        return;
    }
  }

  joinRoom(room: string): void {
    this.ws?.send(enc({ c: "join_room", room }));
  }

  /** After the entry tx confirms on-chain. */
  ready(): void {
    this.push({ phase: "lobby", error: null });
    this.ws?.send(enc({ c: "ready" }));
  }

  setMask(mask: number): void {
    this.mask = mask;
    if (this.self) this.self.input = mask;
    this.ws?.send(enc({ c: "input", seq: ++this.seq, mask }));
  }

  /** Per-frame view (prediction + interpolation). Call from rAF. */
  view(nowMs: number): View {
    const dt = this.lastFrame ? Math.min(0.05, (nowMs - this.lastFrame) / 1000) : 0.016;
    this.lastFrame = nowMs;
    if (this.self && this.simPhase === "live") integrateMovement(this.self, dt);

    const players: ViewPlayer[] = [];
    for (const [id, meta] of this.meta) {
      const isSelf = id === this.signer.publicKeyHex;
      let x: number, y: number;
      if (isSelf && this.self) {
        x = this.self.x; y = this.self.y;
      } else {
        const r = this.remotes.get(id);
        if (!r) continue;
        const span = Math.max(20, r.at - r.prevAt);
        const t = Math.min(1, (nowMs - r.at) / span);
        x = r.px + (r.x - r.px) * Math.min(1, t + 0.5);
        y = r.py + (r.y - r.py) * Math.min(1, t + 0.5);
      }
      players.push({
        id, alias: meta.alias, x, y, carrying: meta.carrying, banked: meta.banked,
        immunity: meta.immunity, connected: meta.connected, isSelf,
        colorIdx: this.colorOf.get(id) ?? 0,
      });
    }
    return { players, loot: [...this.loot.values()], timeLeft: this.timeLeft, phase: this.simPhase };
  }

  private push(patch: Partial<NetState>): void {
    this.state = { ...this.state, ...patch };
    this.onState(this.state);
  }
}
