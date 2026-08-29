import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  createSim, makeRng, rankings, seedInitialLoot, setInput, step,
  DIR_RIGHT, type SimEvent,
} from "../src/shared/sim.ts";
import { LOOT_SMALL } from "../src/shared/constants.ts";
import { isBank } from "../src/shared/map.ts";

const players = [
  { id: "a".repeat(64), alias: "A" },
  { id: "b".repeat(64), alias: "B" },
];

test("countdown → live seeds loot", () => {
  const rng = makeRng(42);
  const sim = createSim(players, rng);
  assert.equal(sim.phase, "countdown");
  const ev: SimEvent[] = [];
  step(sim, 3.1, rng, ev); // burn the countdown
  assert.equal(sim.phase, "live");
  assert.ok(sim.loot.size > 0, "loot spawned at live start");
});

test("pickup increases carrying; banking moves carry→banked", () => {
  const rng = makeRng(7);
  const sim = createSim(players, rng);
  const ev: SimEvent[] = [];
  step(sim, 3.1, rng, ev);
  const p = sim.players.get(players[0]!.id)!;
  // Teleport a loot onto the player and step once.
  sim.loot.clear();
  sim.loot.set(999, { id: 999, kind: "small", x: p.x, y: p.y, value: LOOT_SMALL });
  step(sim, 0.05, rng, ev);
  assert.equal(p.carrying, LOOT_SMALL, "picked up small loot");
  // Drop the player into the bank and step.
  p.x = 11.5; p.y = 13.5;
  assert.ok(isBank(Math.floor(p.x), Math.floor(p.y)));
  step(sim, 0.05, rng, ev);
  assert.equal(p.banked, LOOT_SMALL);
  assert.equal(p.carrying, 0n);
});

test("scatter: higher carrier drops half; banked untouched; immunity set", () => {
  const rng = makeRng(11);
  const sim = createSim(players, rng);
  const ev: SimEvent[] = [];
  step(sim, 3.1, rng, ev);
  sim.loot.clear();
  const a = sim.players.get(players[0]!.id)!;
  const b = sim.players.get(players[1]!.id)!;
  a.carrying = 100n; a.banked = 40n; b.carrying = 20n;
  a.x = 8; a.y = 8; b.x = 8; b.y = 8; // overlapping (floor tile)
  step(sim, 0.05, rng, ev);
  assert.equal(a.carrying, 50n, "higher carrier dropped 50%");
  assert.equal(a.banked, 40n, "banked untouched");
  assert.ok(a.immunity > 0 && b.immunity > 0, "both immune after scatter");
  assert.ok([...sim.loot.values()].length > 0, "dropped loot re-materialized");
});

test("rankings: banked desc, earlier bank breaks ties", () => {
  const rng = makeRng(3);
  const sim = createSim(players, rng);
  const a = sim.players.get(players[0]!.id)!;
  const b = sim.players.get(players[1]!.id)!;
  a.banked = 100n; a.lastBankAt = 50;
  b.banked = 100n; b.lastBankAt = 30; // banked earlier → wins tie
  const r = rankings(sim, [players[0]!.id, players[1]!.id]);
  assert.equal(r[0]!.id, players[1]!.id);
  assert.equal(r[0]!.rank, 1);
});

test("input rejects stale/malformed seq", () => {
  const rng = makeRng(9);
  const sim = createSim(players, rng);
  assert.equal(setInput(sim, players[0]!.id, DIR_RIGHT, 5), true);
  assert.equal(setInput(sim, players[0]!.id, DIR_RIGHT, 5), false, "duplicate seq rejected");
  assert.equal(setInput(sim, players[0]!.id, DIR_RIGHT, 4), false, "older seq rejected");
  assert.equal(setInput(sim, players[0]!.id, 0b11111, 6), false, "malformed mask rejected");
});

test("large cache spawns exactly once near T-20", () => {
  const rng = makeRng(21);
  const sim = createSim(players, rng);
  const ev: SimEvent[] = [];
  step(sim, 3.1, rng, ev);
  // advance to T-19
  let guard = 0;
  while (sim.timeLeft > 19 && guard++ < 10000) step(sim, 0.1, rng, ev);
  const larges = [...sim.loot.values()].filter((l) => l.kind === "large");
  assert.equal(larges.length, 1, "one large cache");
  assert.ok(sim.largeSpawned);
});

test("deterministic: same seed → identical banked outcome", () => {
  const run = (): string => {
    const rng = makeRng(1234);
    const sim = createSim(players, rng);
    const ev: SimEvent[] = [];
    step(sim, 3.1, rng, ev);
    setInput(sim, players[0]!.id, DIR_RIGHT, 1);
    for (let i = 0; i < 200; i++) step(sim, 0.05, rng, ev);
    return [...sim.players.values()].map((p) => `${p.banked}:${Math.round(p.x * 100)}`).join("|");
  };
  assert.equal(run(), run());
});
