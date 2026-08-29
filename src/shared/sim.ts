/**
 * SCRAMBLE_V1 simulation — pure, deterministic given (inputs, seed, dt).
 * The server runs it authoritatively at 20Hz; the client runs the movement
 * half for prediction; practice mode runs all of it locally with bots.
 */

import {
  ACCEL, COUNTDOWN_SECONDS, FRICTION, IMMUNITY_SECONDS,
  LARGE_CACHE_AT_SECONDS_LEFT, LARGE_RADIUS, LOOT_LARGE, LOOT_MEDIUM,
  LOOT_SMALL, MATCH_SECONDS, MAX_SPEED, MEDIUM_INITIAL, MEDIUM_RADIUS,
  MEDIUM_TARGET, PICKUP_TOLERANCE, PLAYER_RADIUS, SCATTER_FRACTION_DEN,
  SCATTER_FRACTION_NUM, SMALL_INITIAL, SMALL_RADIUS, SMALL_TARGET,
} from "./constants";
import { isBank, isWall, LARGE_CACHE_POINT, LOOT_POINTS, SPAWN_PADS } from "./map";
import type { GameScore, Loot, LootKind, PlayerState, RankedPlayer, SimState } from "./types";

// ---------------------------------------------------------------------------
// Deterministic RNG (xorshift32) — server seeds it; identical seed = identical match
// ---------------------------------------------------------------------------

export type Rng = { next: () => number };

export function makeRng(seed: number): Rng {
  let s = seed >>> 0 || 0x9e3779b9;
  return {
    next() {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 0xffffffff;
    },
  };
}

const shuffled = <T,>(arr: readonly T[], rng: Rng): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

// ---------------------------------------------------------------------------
// Events (broadcast by the server; rendered by clients)
// ---------------------------------------------------------------------------

export type SimEvent =
  | { t: "pickup"; player: string; lootId: number; value: string; kind: LootKind }
  | { t: "bank"; player: string; amount: string; banked: string }
  | { t: "scatter"; victim: string; by: string; dropped: string }
  | { t: "loot_spawn"; loot: { id: number; kind: LootKind; x: number; y: number } }
  | { t: "large_cache" }
  | { t: "phase"; phase: SimState["phase"]; timeLeft: number };

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const LOOT_VALUES: Record<LootKind, GameScore> = {
  small: LOOT_SMALL, medium: LOOT_MEDIUM, large: LOOT_LARGE,
};
const LOOT_RADII: Record<LootKind, number> = {
  small: SMALL_RADIUS, medium: MEDIUM_RADIUS, large: LARGE_RADIUS,
};

export function createSim(
  players: { id: string; alias: string }[],
  rng: Rng,
): SimState {
  const pads = shuffled(SPAWN_PADS, rng);
  const map = new Map<string, PlayerState>();
  players.forEach((p, i) => {
    const [x, y] = pads[i % pads.length]!;
    map.set(p.id, {
      id: p.id, alias: p.alias, x, y, vx: 0, vy: 0,
      carrying: 0n, banked: 0n, immunity: 0, lastBankAt: 0,
      connected: true, input: 0, lastInputSeq: 0,
    });
  });
  const sim: SimState = {
    phase: "countdown",
    timeLeft: COUNTDOWN_SECONDS,
    players: map,
    loot: new Map(),
    nextLootId: 1,
    largeSpawned: false,
    matchSeconds: 0,
  };
  return sim;
}

function spawnLoot(sim: SimState, kind: LootKind, rng: Rng, events: SimEvent[], at?: [number, number]): void {
  let x: number, y: number;
  if (at) {
    [x, y] = at;
  } else {
    // A free fixed point ≥2 tiles from every player and the bank.
    const points = shuffled(LOOT_POINTS, rng);
    const taken = new Set(
      [...sim.loot.values()].map((l) => `${Math.round(l.x * 2)}:${Math.round(l.y * 2)}`),
    );
    const ok = points.find(([px, py]) => {
      if (taken.has(`${Math.round(px * 2)}:${Math.round(py * 2)}`)) return false;
      for (const p of sim.players.values()) {
        if (Math.hypot(p.x - px, p.y - py) < 2) return false;
      }
      return true;
    });
    if (!ok) return; // field saturated — try next tick
    [x, y] = ok;
  }
  const loot: Loot = { id: sim.nextLootId++, kind, x, y, value: LOOT_VALUES[kind] };
  sim.loot.set(loot.id, loot);
  events.push({ t: "loot_spawn", loot: { id: loot.id, kind, x, y } });
}

export function seedInitialLoot(sim: SimState, rng: Rng, events: SimEvent[]): void {
  for (let i = 0; i < SMALL_INITIAL; i++) spawnLoot(sim, "small", rng, events);
  for (let i = 0; i < MEDIUM_INITIAL; i++) spawnLoot(sim, "medium", rng, events);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export const DIR_UP = 1, DIR_DOWN = 2, DIR_LEFT = 4, DIR_RIGHT = 8;

/** Returns false when the input must be rejected (stale/duplicate seq). */
export function setInput(sim: SimState, playerId: string, mask: number, seq: number): boolean {
  const p = sim.players.get(playerId);
  if (!p) return false;
  if (seq <= p.lastInputSeq) return false; // replay / out-of-order
  if ((mask & ~0b1111) !== 0) return false; // malformed
  p.lastInputSeq = seq;
  p.input = mask;
  return true;
}

// ---------------------------------------------------------------------------
// Movement (also used client-side for prediction)
// ---------------------------------------------------------------------------

export function integrateMovement(p: { x: number; y: number; vx: number; vy: number; input: number }, dt: number): void {
  let ax = 0, ay = 0;
  if (p.input & DIR_UP) ay -= 1;
  if (p.input & DIR_DOWN) ay += 1;
  if (p.input & DIR_LEFT) ax -= 1;
  if (p.input & DIR_RIGHT) ax += 1;
  const len = Math.hypot(ax, ay);
  if (len > 0) {
    p.vx += (ax / len) * ACCEL * dt;
    p.vy += (ay / len) * ACCEL * dt;
  } else {
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 0) {
      const dec = Math.min(sp, FRICTION * dt);
      p.vx -= (p.vx / sp) * dec;
      p.vy -= (p.vy / sp) * dec;
    }
  }
  const sp = Math.hypot(p.vx, p.vy);
  if (sp > MAX_SPEED) {
    p.vx = (p.vx / sp) * MAX_SPEED;
    p.vy = (p.vy / sp) * MAX_SPEED;
  }
  moveWithWalls(p, p.vx * dt, p.vy * dt);
}

function blockedAt(x: number, y: number): boolean {
  const r = PLAYER_RADIUS;
  return (
    isWall(Math.floor(x - r), Math.floor(y - r)) ||
    isWall(Math.floor(x + r), Math.floor(y - r)) ||
    isWall(Math.floor(x - r), Math.floor(y + r)) ||
    isWall(Math.floor(x + r), Math.floor(y + r))
  );
}

function moveWithWalls(p: { x: number; y: number; vx: number; vy: number }, dx: number, dy: number): void {
  if (!blockedAt(p.x + dx, p.y)) p.x += dx;
  else p.vx = 0;
  if (!blockedAt(p.x, p.y + dy)) p.y += dy;
  else p.vy = 0;
}

// ---------------------------------------------------------------------------
// Tick — the whole authoritative step
// ---------------------------------------------------------------------------

export function step(sim: SimState, dt: number, rng: Rng, events: SimEvent[]): void {
  if (sim.phase === "countdown") {
    sim.timeLeft -= dt;
    if (sim.timeLeft <= 0) {
      sim.phase = "live";
      sim.timeLeft = MATCH_SECONDS;
      seedInitialLoot(sim, rng, events);
      events.push({ t: "phase", phase: "live", timeLeft: sim.timeLeft });
    }
    return;
  }
  if (sim.phase !== "live") return;

  sim.timeLeft -= dt;
  sim.matchSeconds += dt;

  // Large cache — exactly once, at T-20, dead center. Never secret.
  if (!sim.largeSpawned && sim.timeLeft <= LARGE_CACHE_AT_SECONDS_LEFT) {
    sim.largeSpawned = true;
    spawnLoot(sim, "large", rng, events, LARGE_CACHE_POINT);
    events.push({ t: "large_cache" });
  }

  // Movement + immunity decay
  for (const p of sim.players.values()) {
    if (p.immunity > 0) p.immunity = Math.max(0, p.immunity - dt);
    integrateMovement(p, dt);
  }

  // Scatter: overlapping pair → higher carrier drops 50% of carrying.
  const list = [...sim.players.values()];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!, b = list[j]!;
      if (a.immunity > 0 || b.immunity > 0) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) > PLAYER_RADIUS * 2) continue;
      const victim = a.carrying > b.carrying ? a : b.carrying > a.carrying ? b : null;
      if (!victim) continue; // equal (incl. 0-0): no effect
      const other = victim === a ? b : a;
      const dropped = (victim.carrying * SCATTER_FRACTION_NUM) / SCATTER_FRACTION_DEN;
      if (dropped <= 0n) continue;
      victim.carrying = victim.carrying - dropped;
      a.immunity = IMMUNITY_SECONDS;
      b.immunity = IMMUNITY_SECONDS;
      // Re-materialize as pickups in a ring: mediums then smalls.
      let rest = dropped;
      let k = 0;
      while (rest > 0n && k < 12) {
        const kind: LootKind = rest >= LOOT_MEDIUM ? "medium" : "small";
        const val = LOOT_VALUES[kind];
        if (rest < LOOT_SMALL) break; // remainder <10 evaporates (documented)
        const ang = (k / 6) * Math.PI * 2;
        let lx = victim.x + Math.cos(ang) * 1.1;
        let ly = victim.y + Math.sin(ang) * 1.1;
        if (isWall(Math.floor(lx), Math.floor(ly))) { lx = victim.x; ly = victim.y; }
        const loot: Loot = { id: sim.nextLootId++, kind, x: lx, y: ly, value: val };
        sim.loot.set(loot.id, loot);
        events.push({ t: "loot_spawn", loot: { id: loot.id, kind, x: lx, y: ly } });
        rest -= val;
        k++;
      }
      events.push({ t: "scatter", victim: victim.id, by: other.id, dropped: dropped.toString() });
    }
  }

  // Pickups (server-verified overlap) then banking, in that order.
  for (const p of sim.players.values()) {
    for (const loot of sim.loot.values()) {
      const r = PLAYER_RADIUS + LOOT_RADII[loot.kind] + PICKUP_TOLERANCE;
      if (Math.hypot(p.x - loot.x, p.y - loot.y) <= r) {
        sim.loot.delete(loot.id);
        p.carrying = p.carrying + loot.value;
        events.push({ t: "pickup", player: p.id, lootId: loot.id, value: loot.value.toString(), kind: loot.kind });
      }
    }
    if (p.carrying > 0n && isBank(Math.floor(p.x), Math.floor(p.y))) {
      const amt = p.carrying;
      p.banked = p.banked + amt;
      p.carrying = 0n;
      p.lastBankAt = sim.matchSeconds;
      events.push({ t: "bank", player: p.id, amount: amt.toString(), banked: p.banked.toString() });
    }
  }

  // Respawn to density targets (never during the last 5 seconds).
  if (sim.timeLeft > 5) {
    const counts = { small: 0, medium: 0 };
    for (const l of sim.loot.values()) if (l.kind !== "large") counts[l.kind]++;
    if (counts.small < SMALL_TARGET) spawnLoot(sim, "small", rng, events);
    if (counts.medium < MEDIUM_TARGET) spawnLoot(sim, "medium", rng, events);
  }

  if (sim.timeLeft <= 0) {
    sim.phase = "ended";
    sim.timeLeft = 0;
    events.push({ t: "phase", phase: "ended", timeLeft: 0 });
  }
}

// ---------------------------------------------------------------------------
// Rankings — banked desc; tie → earlier final bank wins; then join order.
// ---------------------------------------------------------------------------

export function rankings(sim: SimState, joinOrder: string[]): RankedPlayer[] {
  const rows = joinOrder
    .map((id, i) => ({ p: sim.players.get(id)!, joinIdx: i }))
    .filter((r) => r.p);
  rows.sort((a, b) => {
    if (a.p.banked !== b.p.banked) return a.p.banked > b.p.banked ? -1 : 1;
    if (a.p.lastBankAt !== b.p.lastBankAt) return a.p.lastBankAt - b.p.lastBankAt;
    return a.joinIdx - b.joinIdx;
  });
  return rows.map((r, i) => ({ id: r.p.id, alias: r.p.alias, banked: r.p.banked, rank: i + 1 }));
}
