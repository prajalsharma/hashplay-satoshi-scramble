/**
 * PRACTICE MODE — entirely local, clearly labeled, three simple bots.
 * Uses the SAME shared simulation as the server, so practice is honest about
 * how the real game plays. No wallet, no chain, no shared leaderboard.
 */

import { MATCH_SECONDS } from "../shared/constants";
import { isBank } from "../shared/map";
import {
  createSim, makeRng, rankings, setInput, step,
  DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP, type SimEvent,
} from "../shared/sim";
import type { SimState } from "../shared/types";
import type { View, ViewPlayer } from "./renderer";

const BOT_ALIASES = ["KRAKEN_77", "SATSBOY", "ZEROFOX"];
export const PRACTICE_SELF = "you-practice";

export class PracticeGame {
  sim: SimState;
  private rng = makeRng((Date.now() % 0xffffffff) >>> 0);
  private seq = 1;
  private botSeq = 1000;
  private last = 0;
  events: SimEvent[] = [];
  private colorOf = new Map<string, number>();

  constructor(alias: string) {
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

  /** Bots: greedy loot-seeking; bank when carrying enough or time is short. */
  private driveBots(): void {
    if (this.sim.phase !== "live") return;
    for (const p of this.sim.players.values()) {
      if (p.id === PRACTICE_SELF) continue;
      let tx: number, ty: number;
      const shouldBank = p.carrying >= 60n || (this.sim.timeLeft < 12 && p.carrying > 0n);
      if (shouldBank) {
        tx = 12; ty = 13.5;
      } else {
        let best: { x: number; y: number } | null = null;
        let bestD = Infinity;
        for (const l of this.sim.loot.values()) {
          const d = Math.hypot(l.x - p.x, l.y - p.y);
          if (d < bestD) { bestD = d; best = l; }
        }
        if (!best) continue;
        tx = best.x; ty = best.y;
      }
      if (isBank(Math.floor(p.x), Math.floor(p.y)) && p.carrying === 0n && shouldBank) continue;
      let mask = 0;
      if (ty < p.y - 0.15) mask |= DIR_UP;
      if (ty > p.y + 0.15) mask |= DIR_DOWN;
      if (tx < p.x - 0.15) mask |= DIR_LEFT;
      if (tx > p.x + 0.15) mask |= DIR_RIGHT;
      setInput(this.sim, p.id, mask, this.botSeq++);
    }
  }
}
