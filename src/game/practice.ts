/**
 * PRACTICE MODE — entirely local, clearly labeled, three simple bots.
 * Uses the SAME shared simulation as the server, so practice is honest about
 * how the real game plays. No wallet, no chain, no shared leaderboard.
 */

import { MATCH_SECONDS } from "../shared/constants";
import { LARGE_CACHE_POINT } from "../shared/map";
import {
  createSim, makeRng, rankings, setInput, step,
  DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP, type SimEvent,
} from "../shared/sim";
import type { SimState } from "../shared/types";
import type { View, ViewPlayer } from "./renderer";

const BOT_ALIASES = ["KRAKEN_77", "SATSBOY", "ZEROFOX"];
export const PRACTICE_SELF = "you-practice";

export type Difficulty = "easy" | "medium" | "hard";

/**
 * Bot personality by difficulty. Bots hunt the richest carrier (bumping scatters
 * half their carry), protect their own loot, weight loot by value/distance, and
 * stage at the big-cache point when the floor is clear. Higher tiers hunt more,
 * bank greedier, and make fewer mistakes.
 */
const TUNING: Record<Difficulty, {
  bankAt: bigint; huntChance: number; huntRange: number;
  jitter: number; protectAt: bigint; protectRange: number;
}> = {
  // easy: barely hunts, banks early (leaves loot for you), lots of mistakes.
  easy:   { bankAt: 35n,  huntChance: 0.04, huntRange: 4,  jitter: 0.50, protectAt: 9999n, protectRange: 0 },
  medium: { bankAt: 70n,  huntChance: 0.45, huntRange: 8,  jitter: 0.16, protectAt: 32n,   protectRange: 3 },
  hard:   { bankAt: 110n, huntChance: 0.85, huntRange: 12, jitter: 0.05, protectAt: 22n,   protectRange: 4 },
};

export class PracticeGame {
  sim: SimState;
  private rng = makeRng((Date.now() % 0xffffffff) >>> 0);
  private botRng = makeRng(((Date.now() * 7) % 0xffffffff) >>> 0); // bot decisions — separate from sim RNG
  private difficulty: Difficulty;
  private seq = 1;
  private botSeq = 1000;
  private last = 0;
  events: SimEvent[] = [];
  private colorOf = new Map<string, number>();

  constructor(alias: string, difficulty: Difficulty = "medium") {
    this.difficulty = difficulty;
    const ids = [
      { id: PRACTICE_SELF, alias },
      ...BOT_ALIASES.map((a, i) => ({ id: `bot-${i}`, alias: a })),
    ];
    ids.forEach((p, i) => this.colorOf.set(p.id, i));
    this.sim = createSim(ids, this.rng);
  }

  setMask(mask: number): void {
    setInput(this.sim, PRACTICE_SELF, mask, this.seq++);
  }

  setDifficulty(d: Difficulty): void { this.difficulty = d; }

  /** Advance the local sim; call from rAF. */
  frame(nowMs: number): View {
    const dt = this.last ? Math.min(0.05, (nowMs - this.last) / 1000) : 0.016;
    this.last = nowMs;
    this.driveBots();
    const events: SimEvent[] = [];
    step(this.sim, dt, this.rng, events);
    this.events.push(...events);
    if (this.events.length > 40) this.events.splice(0, this.events.length - 40);

    const players: ViewPlayer[] = [...this.sim.players.values()].map((p) => ({
      id: p.id, alias: p.alias, x: p.x, y: p.y, carrying: p.carrying, banked: p.banked,
      immunity: p.immunity, connected: true, isSelf: p.id === PRACTICE_SELF,
      colorIdx: this.colorOf.get(p.id) ?? 0,
    }));
    return {
      players,
      loot: [...this.sim.loot.values()].map((l) => ({ id: l.id, kind: l.kind, x: l.x, y: l.y })),
      timeLeft: this.sim.timeLeft,
      phase: this.sim.phase,
    };
  }

  leaderboard() {
    return rankings(this.sim, [PRACTICE_SELF, "bot-0", "bot-1", "bot-2"]).map((r) => ({
      id: r.id, alias: r.alias, banked: r.banked.toString(), rank: r.rank,
    }));
  }

  progress(): number {
    return 1 - this.sim.timeLeft / MATCH_SECONDS;
  }

  /**
   * Competitive bots: hunt the richest carrier (bumping scatters half their
   * carry), protect their own loot from nearby rivals, chase value-weighted
   * loot, and stage at the big cache when the floor is clear — never oscillate.
   */
  private driveBots(): void {
    if (this.sim.phase !== "live") return;
    const t = TUNING[this.difficulty];
    const BANK_X = 12, BANK_Y = 13.5;

    // Richest carrying player = the juiciest bump target (includes the human).
    let leader: { id: string; x: number; y: number; carrying: bigint } | null = null;
    for (const q of this.sim.players.values()) {
      if (!leader || q.carrying > leader.carrying) leader = { id: q.id, x: q.x, y: q.y, carrying: q.carrying };
    }

    for (const p of this.sim.players.values()) {
      if (p.id === PRACTICE_SELF) continue;
      const timeShort = this.sim.timeLeft < 12;

      // Distance to the closest rival — used to decide whether to protect.
      let nearRival = Infinity;
      for (const q of this.sim.players.values()) {
        if (q.id === p.id) continue;
        const dd = Math.hypot(q.x - p.x, q.y - p.y);
        if (dd < nearRival) nearRival = dd;
      }

      const shouldBank = p.carrying >= t.bankAt || (timeShort && p.carrying > 0n);
      const threatened = p.carrying >= t.protectAt && nearRival < t.protectRange;
      const distToLeader = leader ? Math.hypot(leader.x - p.x, leader.y - p.y) : Infinity;
      const canHunt =
        leader != null && leader.id !== p.id && leader.carrying >= 25n &&
        distToLeader <= t.huntRange && distToLeader > 1.3 && // peel off once close — grab the scatter, don't pile up
        this.botRng.next() < t.huntChance;

      let tx: number, ty: number;
      if (shouldBank || threatened) {
        tx = BANK_X; ty = BANK_Y;                    // cash in / protect
      } else if (canHunt && leader) {
        tx = leader.x; ty = leader.y;                // chase to bump-scatter
      } else {
        let best: { x: number; y: number } | null = null, bestScore = -Infinity;
        for (const l of this.sim.loot.values()) {
          const dist = Math.hypot(l.x - p.x, l.y - p.y) + 0.1;
          const val = l.kind === "large" ? 100 : l.kind === "medium" ? 25 : 10;
          const score = val / dist;                  // value-weighted, not just nearest
          if (score > bestScore) { bestScore = score; best = l; }
        }
        if (best) { tx = best.x; ty = best.y; }
        else { tx = LARGE_CACHE_POINT[0]; ty = LARGE_CACHE_POINT[1]; } // stage for the cache — no wandering
      }

      // Move toward the target with a deadzone (stop instead of jittering there).
      let mask = 0;
      const dz = 0.4;
      if (ty < p.y - dz) mask |= DIR_UP;
      if (ty > p.y + dz) mask |= DIR_DOWN;
      if (tx < p.x - dz) mask |= DIR_LEFT;
      if (tx > p.x + dz) mask |= DIR_RIGHT;
      // Occasional wrong step keeps them human (frequent on easy, rare on hard).
      if (this.botRng.next() < t.jitter) {
        mask = [DIR_UP, DIR_DOWN, DIR_LEFT, DIR_RIGHT][Math.floor(this.botRng.next() * 4)]!;
      }
      setInput(this.sim, p.id, mask, this.botSeq++);
    }
  }
}
