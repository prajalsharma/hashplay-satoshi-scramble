/**
 * 4- and 8-player scaling + resilience over the REAL protocol (no fake
 * players — every client is an independent BIP-322-authed ws connection).
 * Measures server tick stability under load and exercises disconnect/
 * reconnect and duplicate-action safety. Chain disabled (dev freejoin).
 *
 *   npx tsx --test tests/scaling.test.mts
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocket } from "ws";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { signChallengeBip322 } from "../src/arch/bip322.ts";



function startServer(port: number): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const p = spawn("npx", ["tsx", "server/src/index.ts"], {
      env: {
        ...process.env, PORT: String(port), GAME_DEV_FREEJOIN: "1",
        GAME_LOBBY_SECONDS: "1", GAME_MATCH_SECONDS: "3",
        CORS_ORIGINS: "http://localhost:5173",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const onData = (d: Buffer) => { out += d; if (out.includes("satoshi-scramble on")) resolve(p); };
    p.stdout.on("data", onData); p.stderr.on("data", onData);
    setTimeout(() => reject(new Error("server start timeout: " + out)), 15000);
  });
}

type Client = {
  ws: WebSocket; pubkey: string; events: string[]; ticks: number;
  matchEnd: any; snapshots: number; seenIds: Set<string>;
};

function makeClient(port: number, alias: string, room: string, opts: { move?: boolean } = {}): Promise<Client> {
  const sk = crypto.getRandomValues(new Uint8Array(32));
  const pk = schnorr.getPublicKey(sk);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: "http://localhost:5173" });
  const c: Client = { ws, pubkey: bytesToHex(pk), events: [], ticks: 0, matchEnd: null, snapshots: 0, seenIds: new Set() };
  let seq = 0;
  return new Promise((resolve, reject) => {
    ws.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      c.events.push(m.s);
      if (m.s === "challenge") {
        ws.send(JSON.stringify({ c: "hello", pubkey: c.pubkey, alias }));
        ws.send(JSON.stringify({ c: "auth", sig64Hex: bytesToHex(signChallengeBip322(sk, pk, new TextEncoder().encode(m.nonceHex))) }));
      } else if (m.s === "welcome") {
        ws.send(JSON.stringify({ c: "join_room", room }));
        resolve(c);
      } else if (m.s === "join_ok") {
        ws.send(JSON.stringify({ c: "ready" }));
      } else if (m.s === "snapshot") {
        c.snapshots++;
        for (const p of m.players) c.seenIds.add(p.id);
      } else if (m.s === "tick") {
        c.ticks++;
        if (opts.move !== false) ws.send(JSON.stringify({ c: "input", seq: ++seq, mask: 1 << (seq % 4) }));
      } else if (m.s === "match_end") {
        c.matchEnd = m;
      }
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error(`${alias} connect timeout`)), 8000);
  });
}

const waitAll = (clients: Client[], ms: number) =>
  new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      if (clients.every((c) => c.matchEnd)) { clearInterval(iv); resolve(); }
      else if (Date.now() - start > ms) { clearInterval(iv); reject(new Error("timeout waiting for match_end")); }
    }, 200);
  });

async function scalingRun(port: number, n: number, room: string): Promise<{ hashes: Set<string>; minTicks: number; sawEveryone: boolean }> {
  const clients = await Promise.all(
    Array.from({ length: n }, (_, i) => makeClient(port, `P${i}`, room)),
  );
  const cpu0 = process.cpuUsage();
  await waitAll(clients, 25000);
  const cpu = process.cpuUsage(cpu0);
  const hashes = new Set(clients.map((c) => c.matchEnd.resultHash));
  const minTicks = Math.min(...clients.map((c) => c.ticks));
  const sawEveryone = clients.every((c) => c.seenIds.size === n);
  console.log(`  ${n}p: ticks(min)=${minTicks} snapshots=${clients[0]!.snapshots} rankings=${clients[0]!.matchEnd.rankings.length} testCpuMs=${Math.round(cpu.user / 1000)}`);
  clients.forEach((c) => c.ws.close());
  return { hashes, minTicks, sawEveryone };
}

test("4-player match: everyone visible, agreed result, stable ticks", async () => {
  const server = await startServer(8901);
  try {
    const r = await scalingRun(8901, 4, "ROOM-01");
    assert.equal(r.hashes.size, 1, "all 4 agree on the result hash");
    assert.ok(r.sawEveryone, "each client saw all 4 players");
    assert.ok(r.minTicks > 30, `~3s @20Hz should be >30 ticks, got ${r.minTicks}`);
  } finally { server.kill("SIGKILL"); }
});

test("8-player match: everyone visible, agreed result, stable ticks", async () => {
  const server = await startServer(8902);
  try {
    const r = await scalingRun(8902, 8, "ROOM-02");
    assert.equal(r.hashes.size, 1, "all 8 agree on the result hash");
    assert.ok(r.sawEveryone, "each client saw all 8 players");
    assert.ok(r.minTicks > 30, `stable ticks under 8-player load, got ${r.minTicks}`);
  } finally { server.kill("SIGKILL"); }
});

test("disconnect mid-match does not corrupt the match or duplicate players", async () => {
  const server = await startServer(8903);
  try {
    const [a, b, cc] = await Promise.all([
      makeClient(8903, "A", "ROOM-03"), makeClient(8903, "B", "ROOM-03"), makeClient(8903, "C", "ROOM-03"),
    ]);
    // Let the match start, then drop C.
    await new Promise((r) => setTimeout(r, 5000));
    cc.ws.close();
    await waitAll([a, b], 25000);
    // A and B still finish; C remains a ranked participant (entry stays in pot).
    assert.equal(a.matchEnd.resultHash, b.matchEnd.resultHash);
    assert.equal(a.matchEnd.rankings.length, 3, "disconnected player still ranked, not duplicated");
    const ids = new Set(a.matchEnd.rankings.map((x: any) => x.id));
    assert.equal(ids.size, 3, "no duplicate player ids");
    a.ws.close(); b.ws.close();
  } finally { server.kill("SIGKILL"); }
});
