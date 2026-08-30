/**
 * A public room: lobby → countdown → live (20Hz authoritative sim) →
 * ended → settlement → fresh lobby. The room owns nothing financial —
 * joins and payouts live on-chain (server/src/chain.ts).
 */

import type { WebSocket } from "ws";
import {
  ENTRY_BASE_UNITS, LOBBY_FILL_SECONDS, MAX_INPUTS_PER_SEC, MAX_PLAYERS,
  MIN_PLAYERS, TICK_MS,
} from "../../src/shared/constants";
import {
  createSim, makeRng, rankings as rankSim, setInput, step, type SimEvent,
} from "../../src/shared/sim";
import type { SimState, CanonicalResult } from "../../src/shared/types";
import { enc, type PlayerSnap, type RoomInfo, type ServerMsg } from "../../src/shared/protocol";
import { chainEnabled, createMatchOnChain, readMatch, settleOnChain } from "./chain";
import { matchPda } from "../../src/arch/program";
import { bytesToHex } from "@noble/hashes/utils.js";
import { RULESET_VERSION } from "../../src/shared/constants";

const DEV_FREEJOIN = process.env.GAME_DEV_FREEJOIN === "1";

export type Session = {
  ws: WebSocket | null;
  pubkey: string; // hex — verified via BIP-322 challenge
  alias: string;
  resumeToken: string;
  room: Room | null;
  joinedOnChain: boolean;
  inputTimestamps: number[];
  disconnectedAt: number | null;
};

type RoomPhase = "waiting" | "lobby" | "countdown" | "live" | "ended";

export class Room {
  readonly id: string;
  phase: RoomPhase = "waiting";
  matchId: bigint | null = null;
  matchCreated = false;
  matchCreatedAt = 0;
  sessions = new Map<string, Session>(); // by pubkey
  joinOrder: string[] = [];
  sim: SimState | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick = 0;
  private lobbyStartedAt = 0;
  private startTs = 0;
  private settling = false;
  lastSettlement: { state: string; txid?: string; hash?: string } | null = null;
  private lastMatchEnd: ServerMsg | null = null;

  constructor(id: string) {
    this.id = id;
  }

  info(): RoomInfo {
    return {
      room: this.id,
      players: this.joinOrder.length,
      capacity: MAX_PLAYERS,
      entryBaseUnits: ENTRY_BASE_UNITS.toString(),
      state: this.phase === "waiting" ? "waiting" : this.phase === "lobby" ? "lobby" : this.phase,
      matchId: this.matchId?.toString() ?? null,
    };
  }

  /** A player wants in: ensure the on-chain match exists, hand back its id. */
  async requestJoin(sess: Session): Promise<{ matchId: string; matchPdaHex: string }> {
    if (this.phase === "live" || this.phase === "countdown" || this.phase === "ended") {
      throw new Error("MATCH IN PROGRESS — WAIT FOR THE NEXT ROUND");
    }
    if (this.joinOrder.length >= MAX_PLAYERS) throw new Error("ROOM FULL");
    // Recycle a stale match: its on-chain join_deadline (JOIN_TIMEOUT_SECS=180s)
    // expires while a lobby waits; joining an expired match fails with 0xA. If
    // nobody has staked yet, drop it so a fresh match (fresh window) is created.
    const STALE_MS = 150_000;
    if (this.matchCreated && this.joinOrder.length === 0 &&
        Date.now() - this.matchCreatedAt > STALE_MS) {
      this.matchId = null;
      this.matchCreated = false;
      for (const s of this.sessions.values()) s.joinedOnChain = false;
    }
    if (this.matchId === null) {
      this.matchId = BigInt(Date.now()) * 10n + BigInt(this.id.charCodeAt(this.id.length - 1) % 10);
    }
    if (chainEnabled() && !this.matchCreated) {
      await createMatchOnChain(this.matchId, MAX_PLAYERS);
      this.matchCreated = true;
      this.matchCreatedAt = Date.now();
    }
    sess.room = this;
    this.sessions.set(sess.pubkey, sess);
    this.phase = this.phase === "waiting" ? "lobby" : this.phase;
    if (this.lobbyStartedAt === 0) this.lobbyStartedAt = Date.now();
    // Broadcast so every room member syncs the current matchId (it changes when
    // a stale match is recycled) — clients stake against the latest one.
    this.broadcastRoomState();
    return {
      matchId: this.matchId.toString(),
      matchPdaHex: chainEnabled() ? bytesToHex(matchPda(this.matchId)) : "",
    };
  }

  /** Player claims their entry tx landed — verify against the chain. */
  async confirmReady(sess: Session): Promise<void> {
    if (this.matchId === null) throw new Error("NO OPEN MATCH");
    if (sess.joinedOnChain) return;
    if (chainEnabled()) {
      const m = await readMatch(this.matchId);
      if (!m || !m.players.includes(sess.pubkey)) {
        throw new Error("ENTRY NOT ON-CHAIN YET — CONFIRM THE TRANSACTION AND RETRY");
      }
    } else if (!DEV_FREEJOIN) {
      throw new Error("CHAIN DISABLED AND DEV FREEJOIN OFF");
    }
    sess.joinedOnChain = true;
    if (!this.joinOrder.includes(sess.pubkey)) this.joinOrder.push(sess.pubkey);
    this.broadcastRoomState();
    this.maybeStart();
  }

  private maybeStart(): void {
    if (this.phase !== "lobby") return;
    const n = this.joinOrder.length;
    const lobbyElapsed = (Date.now() - this.lobbyStartedAt) / 1000;
    const fillWindow = Number(process.env.GAME_LOBBY_SECONDS ?? LOBBY_FILL_SECONDS);
    if (n >= MAX_PLAYERS || (n >= MIN_PLAYERS && lobbyElapsed >= fillWindow)) {
      this.start();
    } else if (n >= MIN_PLAYERS) {
      // Fill-window timer: check again when the window would elapse.
      setTimeout(() => this.maybeStart(), Math.max(300, (fillWindow - lobbyElapsed) * 1000 + 100));
    }
  }

  /** For tests: force-start once MIN_PLAYERS present. */
  forceStart(): void {
    if (this.phase === "lobby" && this.joinOrder.length >= MIN_PLAYERS) this.start();
  }

  private start(): void {
    this.phase = "countdown";
    this.startTs = Math.floor(Date.now() / 1000);
    const rng = makeRng(Number(this.matchId! % 0xffffffffn) ^ this.startTs);
    this.sim = createSim(
      this.joinOrder.map((id) => ({ id, alias: this.sessions.get(id)?.alias ?? "PLAYER" })),
      rng,
    );
    this.rng = rng;
    this.broadcast({ s: "match_start", matchId: this.matchId!.toString() });
    this.broadcastSnapshot();
    this.tickLoopStart();
  }

  private rng = makeRng(1);

  private tickLoopStart(): void {
    if (this.timer) clearInterval(this.timer);
    let last = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.onTick(dt);
    }, TICK_MS);
  }

  private onTick(dt: number): void {
    const sim = this.sim;
    if (!sim) return;
    const events: SimEvent[] = [];
    step(sim, dt, this.rng, events);
    this.tick++;

    if (sim.phase === "live" && this.phase === "countdown") {
      this.phase = "live";
      // Dev-only match shortening for automated tests (never in production).
      const devSecs = Number(process.env.GAME_MATCH_SECONDS ?? 0);
      if (devSecs > 0) sim.timeLeft = devSecs;
    }

    // Broadcast: movement delta every tick, full snapshot every 40 ticks (2s).
    const moved: [string, number, number, number, number][] = [];
    for (const p of sim.players.values()) {
      moved.push([p.id, round2(p.x), round2(p.y), round2(p.vx), round2(p.vy)]);
    }
    this.broadcast({ s: "tick", tick: this.tick, timeLeft: round2(sim.timeLeft), moved, events });
    if (this.tick % 40 === 0) this.broadcastSnapshot();
    if (events.some((e) => e.t === "bank" || e.t === "scatter")) this.broadcastLeaderboard();

    if (sim.phase === "ended" && this.phase === "live") {
      this.phase = "ended";
      if (this.timer) clearInterval(this.timer);
      void this.finish();
    }
  }

  private async finish(): Promise<void> {
    const sim = this.sim!;
    const ranked = rankSim(sim, this.joinOrder);
    const result: CanonicalResult = {
      game: "satoshi-scramble",
      ruleset: RULESET_VERSION,
      matchId: this.matchId!,
      roomId: this.id,
      entry: ENTRY_BASE_UNITS,
      players: this.joinOrder.map((id) => ({ id, banked: sim.players.get(id)!.banked })),
      rankings: ranked.map((r) => this.joinOrder.indexOf(r.id)),
      startTs: this.startTs,
      endTs: Math.floor(Date.now() / 1000),
    };
    const { resultHash } = await import("../../src/shared/result");
    const hash = resultHash(result);
    this.lastMatchEnd = {
      s: "match_end",
      rankings: ranked.map((r) => ({ id: r.id, alias: r.alias, banked: r.banked.toString(), rank: r.rank })),
      resultHash: hash,
    };
    this.broadcast(this.lastMatchEnd);

    if (chainEnabled() && !this.settling) {
      this.settling = true;
      this.lastSettlement = { state: "pending" };
      this.broadcast({ s: "settlement", state: "pending" });
      try {
        const { txid } = await settleOnChain(result);
        this.lastSettlement = { state: "confirmed", txid, hash };
        this.broadcast({ s: "settlement", state: "confirmed", txid });
        console.log(`[room ${this.id}] settled ${this.matchId} tx=${txid.slice(0, 12)}…`);
      } catch (e) {
        this.lastSettlement = { state: "failed" };
        this.broadcast({ s: "settlement", state: "failed" });
        console.error(`[room ${this.id}] settlement FAILED:`, (e as Error).message);
      }
    }
    // Fresh cycle after a short results pause.
    setTimeout(() => this.reset(), 8000);
  }

  private reset(): void {
    this.phase = "waiting";
    this.matchId = null;
    this.matchCreated = false;
    this.matchCreatedAt = 0;
    this.sim = null;
    this.joinOrder = [];
    this.lobbyStartedAt = 0;
    this.settling = false;
    this.lastMatchEnd = null;
    this.lastSettlement = null;
    this.tick = 0;
    for (const s of this.sessions.values()) {
      s.joinedOnChain = false;
      s.room = null;
    }
    this.sessions.clear();
    this.broadcastRoomState();
  }

  // ---- input --------------------------------------------------------------

  handleInput(sess: Session, seq: number, mask: number): void {
    if (!this.sim || (this.phase !== "live" && this.phase !== "countdown")) return;
    if (!sess.joinedOnChain) return;
    // Rate limit: MAX_INPUTS_PER_SEC over a sliding second.
    const now = Date.now();
    sess.inputTimestamps = sess.inputTimestamps.filter((t) => now - t < 1000);
    if (sess.inputTimestamps.length >= MAX_INPUTS_PER_SEC) return;
    sess.inputTimestamps.push(now);
    setInput(this.sim, sess.pubkey, mask, seq);
  }

  handleDisconnect(sess: Session): void {
    sess.disconnectedAt = Date.now();
    const p = this.sim?.players.get(sess.pubkey);
    if (p) {
      p.connected = false;
      p.input = 0; // idles at last position; DESIGN.md disconnect rules
    }
    if (this.phase === "lobby" && !sess.joinedOnChain) {
      this.sessions.delete(sess.pubkey);
      this.broadcastRoomState();
    }
  }

  handleResume(sess: Session, ws: WebSocket): void {
    sess.ws = ws;
    sess.disconnectedAt = null;
    const p = this.sim?.players.get(sess.pubkey);
    if (p) p.connected = true;
    this.sendSnapshotTo(sess);
    // A player who dropped right before the finish still gets the final result
    // and settlement on reconnect (until the room recycles).
    if (this.lastMatchEnd) this.sendTo(sess, this.lastMatchEnd);
    if (this.lastSettlement) {
      this.sendTo(sess, { s: "settlement", state: this.lastSettlement.state as never, txid: this.lastSettlement.txid });
    }
  }

  // ---- broadcast ----------------------------------------------------------

  private snapshotMsg(): ServerMsg {
    const sim = this.sim!;
    const players: PlayerSnap[] = [...sim.players.values()].map((p) => ({
      id: p.id, alias: p.alias, x: round2(p.x), y: round2(p.y),
      vx: round2(p.vx), vy: round2(p.vy),
      carrying: p.carrying.toString(), banked: p.banked.toString(),
      immunity: round2(p.immunity), connected: p.connected,
    }));
    const loot = [...sim.loot.values()].map((l) => ({ id: l.id, kind: l.kind, x: round2(l.x), y: round2(l.y) }));
    return { s: "snapshot", phase: sim.phase, timeLeft: round2(sim.timeLeft), players, loot, tick: this.tick };
  }

  broadcastSnapshot(): void {
    if (this.sim) this.broadcast(this.snapshotMsg());
  }

  sendSnapshotTo(sess: Session): void {
    if (this.sim) this.sendTo(sess, this.snapshotMsg());
    else this.sendTo(sess, { s: "room_state", room: this.info(), players: this.playerRows() });
  }

  broadcastLeaderboard(): void {
    if (!this.sim) return;
    const rows = rankSim(this.sim, this.joinOrder).map((r) => ({
      id: r.id, alias: r.alias, banked: r.banked.toString(), rank: r.rank,
    }));
    this.broadcast({ s: "leaderboard", rows });
  }

  private playerRows() {
    return [...this.sessions.values()].map((s) => ({
      id: s.pubkey, alias: s.alias, joined: s.joinedOnChain,
    }));
  }

  broadcastRoomState(): void {
    this.broadcast({ s: "room_state", room: this.info(), players: this.playerRows() });
  }

  broadcast(msg: ServerMsg): void {
    const raw = enc(msg);
    for (const s of this.sessions.values()) {
      if (s.ws && s.ws.readyState === s.ws.OPEN) s.ws.send(raw);
    }
  }

  sendTo(sess: Session, msg: ServerMsg): void {
    if (sess.ws && sess.ws.readyState === sess.ws.OPEN) sess.ws.send(enc(msg));
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
