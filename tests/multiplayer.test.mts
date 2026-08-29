/**
 * Two-player local integration: spins up the real WS server (chain disabled,
 * dev freejoin), connects two BIP-322-authed ws clients, plays a shortened
 * match, asserts both see match_start, a moving world, and match_end with a
 * result hash. Proves the authoritative server + protocol end-to-end without
 * touching the chain.
 *
 *   npx tsx --test tests/multiplayer.test.mts
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { signChallengeBip322 } from "../src/arch/bip322.ts";
import { loginMessage } from "../src/shared/protocol.ts";

const PORT = 8899;

function startServer(): Promise<{ kill: () => void }> {
  return new Promise((resolve, reject) => {
    const p = spawn("npx", ["tsx", "server/src/index.ts"], {
      env: {
        ...process.env,
        PORT: String(PORT),
        GAME_DEV_FREEJOIN: "1",
        GAME_LOBBY_SECONDS: "1",
        GAME_MATCH_SECONDS: "2",
        CORS_ORIGINS: "http://localhost:5173",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const onData = (d: Buffer) => {
      out += d.toString();
      if (out.includes("satoshi-scramble on")) resolve({ kill: () => p.kill("SIGKILL") });
    };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    p.on("exit", (c) => { if (c !== 0 && !out.includes("satoshi-scramble on")) reject(new Error("server exited: " + out)); });
    setTimeout(() => reject(new Error("server start timeout: " + out)), 15000);
  });
}

type Client = { ws: WebSocket; pubkey: string; events: string[]; matchEnd: any };

function connect(alias: string): Promise<Client> {
  const sk = crypto.getRandomValues(new Uint8Array(32));
  const pk = schnorr.getPublicKey(sk);
  const pubkey = bytesToHex(pk);
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { origin: "http://localhost:5173" });
  const client: Client = { ws, pubkey, events: [], matchEnd: null };
  return new Promise((resolve, reject) => {
    ws.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      client.events.push(m.s);
      if (m.s === "challenge") {
        ws.send(JSON.stringify({ c: "hello", pubkey, alias }));
        const sig = signChallengeBip322(sk, pk, new TextEncoder().encode(loginMessage(m.nonceHex)));
        ws.send(JSON.stringify({ c: "auth", sig64Hex: bytesToHex(sig) }));
      } else if (m.s === "welcome") {
        resolve(client);
      } else if (m.s === "join_ok") {
        ws.send(JSON.stringify({ c: "ready" }));
      } else if (m.s === "match_start") {
        // drive a little movement so the world visibly ticks
        ws.send(JSON.stringify({ c: "input", seq: 1, mask: 8 }));
      } else if (m.s === "match_end") {
        client.matchEnd = m;
      }
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 8000);
  });
}

test("two players share a room and finish a match with a result hash", async () => {
  const server = await startServer();
  try {
    const [a, b] = await Promise.all([connect("ALICE"), connect("BOB")]);
    a.ws.send(JSON.stringify({ c: "join_room", room: "ROOM-01" }));
    b.ws.send(JSON.stringify({ c: "join_room", room: "ROOM-01" }));

    // Wait for both match_end (lobby 1s + countdown 3s + match 2s ≈ 6s).
    await new Promise<void>((resolve, reject) => {
      const started = Date.now();
      const iv = setInterval(() => {
        if (a.matchEnd && b.matchEnd) { clearInterval(iv); resolve(); }
        else if (Date.now() - started > 20000) { clearInterval(iv); reject(new Error("no match_end")); }
      }, 200);
    });

    assert.ok(a.events.includes("match_start"), "A saw match_start");
    assert.ok(b.events.includes("snapshot"), "B received world snapshots");
    assert.ok(a.events.filter((e) => e === "tick").length > 10, "A received many ticks");
    assert.match(a.matchEnd.resultHash, /^[0-9a-f]{64}$/);
    assert.equal(a.matchEnd.resultHash, b.matchEnd.resultHash, "both agree on the result hash");
    assert.equal(a.matchEnd.rankings.length, 2, "two ranked players");
    assert.ok(a.matchEnd.rankings.some((r: any) => r.id === a.pubkey), "A is ranked");

    a.ws.close(); b.ws.close();
  } finally {
    server.kill();
  }
});
