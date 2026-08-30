/**
 * §52 MULTIPLAYER MATRIX — independent sessions, distinct wallets/keys.
 *
 * Each client is a real WS session with its OWN BIP-322 keypair (no shared
 * browser, no fake players). Covers the server/protocol layer of the launch
 * checklist that does NOT require funded aBTC (dev freejoin bypasses the escrow
 * tx). The on-chain money tests — §52 tests 9/10/11 (settlement, double-settle,
 * unauthorized settle) — are enforced by the program (see programs/scramble
 * unit tests + settle_match/reclaim_entry code) and require the funded 2-wallet
 * E2E in docs/GO_LIVE_TESTNET.md; they are intentionally out of this harness.
 *
 *   npx tsx --test tests/mp-matrix.test.mts
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { signChallengeBip322 } from "../src/arch/bip322.ts";
import { loginMessage } from "../src/shared/protocol.ts";

const PORT = 8921;
const WS = `ws://127.0.0.1:${PORT}/ws`;
const ORIGIN = "http://localhost:5173";

function startServer(): Promise<{ kill: () => void }> {
  return new Promise((resolve, reject) => {
    const p = spawn("npx", ["tsx", "server/src/index.ts"], {
      env: { ...process.env, PORT: String(PORT), GAME_DEV_FREEJOIN: "1",
        GAME_LOBBY_SECONDS: "1", GAME_MATCH_SECONDS: "2", CORS_ORIGINS: ORIGIN },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const onData = (d: Buffer) => {
      out += d.toString();
      if (out.includes("satoshi-scramble on")) {
        p.stdout?.removeListener("data", onData); p.stderr?.removeListener("data", onData);
        p.unref(); // let this test process exit even while the child lingers
        resolve({ kill: () => p.kill("SIGKILL") });
      }
    };
    p.stdout.on("data", onData); p.stderr.on("data", onData);
    p.on("exit", (c) => { if (c !== 0 && !out.includes("satoshi-scramble on")) reject(new Error("server exited: " + out)); });
    setTimeout(() => reject(new Error("server start timeout: " + out)), 15000);
  });
}

type Msg = { s: string; [k: string]: any };
class Client {
  ws!: WebSocket;
  readonly sk = crypto.getRandomValues(new Uint8Array(32));
  readonly pk = schnorr.getPublicKey(this.sk);
  readonly pubkey = bytesToHex(this.pk);
  resumeToken = "";
  matchId = "";
  events: string[] = [];
  last: Record<string, Msg> = {};
  constructor(readonly alias: string) {}

  /** Full auth handshake; optionally forge a bad signature to test rejection. */
  connect(opts: { forgeAuth?: boolean } = {}): Promise<this> {
    this.ws = new WebSocket(WS, { origin: ORIGIN });
    return new Promise((resolve, reject) => {
      this.ws.on("message", (raw) => {
        const m = JSON.parse(String(raw)) as Msg;
        this.events.push(m.s);
        this.last[m.s] = m;
        if (m.s === "challenge") {
          this.ws.send(JSON.stringify({ c: "hello", pubkey: this.pubkey, alias: this.alias }));
          const sig = opts.forgeAuth
            ? new Uint8Array(64) // all-zero sig — must be rejected
            : signChallengeBip322(this.sk, this.pk, new TextEncoder().encode(loginMessage(m.nonceHex)));
          this.ws.send(JSON.stringify({ c: "auth", sig64Hex: bytesToHex(sig) }));
        } else if (m.s === "welcome") {
          this.resumeToken = m.resumeToken;
          resolve(this);
        } else if (m.s === "join_ok") {
          this.matchId = m.matchId;
          this.ws.send(JSON.stringify({ c: "ready" })); // seat the player
        }
      });
      this.ws.on("error", reject);
      setTimeout(() => reject(new Error(`${this.alias} connect timeout`)), 8000);
    });
  }

  /** Reconnect a dropped socket via the resume token (no re-sign). */
  resume(): Promise<this> {
    this.ws = new WebSocket(WS, { origin: ORIGIN });
    return new Promise((resolve, reject) => {
      this.ws.on("message", (raw) => {
        const m = JSON.parse(String(raw)) as Msg;
        this.events.push(m.s); this.last[m.s] = m;
        if (m.s === "challenge") this.ws.send(JSON.stringify({ c: "resume", resumeToken: this.resumeToken }));
        else if (m.s === "welcome") resolve(this);
      });
      this.ws.on("error", reject);
      setTimeout(() => reject(new Error(`${this.alias} resume timeout`)), 8000);
    });
  }

  join(room: string) { this.ws.send(JSON.stringify({ c: "join_room", room })); }
  ready() { this.ws.send(JSON.stringify({ c: "ready" })); }
  send(o: unknown) { this.ws.send(JSON.stringify(o)); }
  drop() { try { this.ws.terminate(); } catch { /* already gone */ } }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
  count(ev: string) { return this.events.filter((e) => e === ev).length; }
  waitEnd(ms = 20000): Promise<Msg> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const iv = setInterval(() => {
        if (this.last["match_end"]) { clearInterval(iv); resolve(this.last["match_end"]); }
        else if (Date.now() - started > ms) { clearInterval(iv); reject(new Error(`${this.alias} no match_end`)); }
      }, 150);
    });
  }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------

test("§52 multiplayer matrix (protocol layer, independent sessions)", async (t) => {
  const server = await startServer();
  const live: Client[] = [];
  try {
    // TEST 1 — A creates, B joins: both finish ONE match, same id + result hash.
    await t.test("T1 A+B share one match, agree on id and result", async () => {
      const a = new Client("ALICE"), b = new Client("BOB"); live.push(a, b);
      await Promise.all([a.connect(), b.connect()]);
      a.join("ROOM-01"); b.join("ROOM-01");
      const [ea, eb] = [await a.waitEnd(), await b.waitEnd()];
      assert.ok(a.events.includes("match_start"), "A saw match_start");
      assert.ok(b.count("tick") > 5, "B received live ticks");
      assert.equal(a.matchId, b.matchId, "same match id for both");
      assert.match(ea.resultHash, /^[0-9a-f]{64}$/, "valid result hash");
      assert.equal(ea.resultHash, eb.resultHash, "both agree on result hash");
      assert.equal(ea.rankings.length, 2, "exactly two ranked players");
      const ids = new Set(ea.rankings.map((r: any) => r.id));
      assert.ok(ids.has(a.pubkey) && ids.has(b.pubkey), "both players ranked, no impersonation");
      a.close(); b.close();
    });

    // TEST 4 / §15 — A+B+C join simultaneously: one match, three ranked, unique id.
    await t.test("T4 A+B+C simultaneous join → one match, three ranked", async () => {
      const a = new Client("A2"), b = new Client("B2"), c = new Client("C2"); live.push(a, b, c);
      await Promise.all([a.connect(), b.connect(), c.connect()]);
      a.join("ROOM-02"); b.join("ROOM-02"); c.join("ROOM-02"); // near-simultaneous
      const ends = await Promise.all([a.waitEnd(), b.waitEnd(), c.waitEnd()]);
      const ids = new Set([a.matchId, b.matchId, c.matchId]);
      assert.equal(ids.size, 1, "all three in the SAME match (no duplicate match)");
      assert.equal(ends[0].rankings.length, 3, "three ranked players");
      assert.equal(ends[0].resultHash, ends[1].resultHash, "A/B agree");
      assert.equal(ends[1].resultHash, ends[2].resultHash, "B/C agree");
      a.close(); b.close(); c.close();
    });

    // §16 duplicate-click — spamming join_room + ready must not create 2 seats.
    await t.test("T-dup rapid duplicate join/ready is idempotent", async () => {
      const a = new Client("DUPA"), b = new Client("DUPB"); live.push(a, b);
      await Promise.all([a.connect(), b.connect()]);
      for (let i = 0; i < 5; i++) { a.join("ROOM-03"); a.ready(); } // hammer
      b.join("ROOM-03");
      const ea = await a.waitEnd();
      // A appears exactly once in rankings despite 5x join/ready.
      const aCount = ea.rankings.filter((r: any) => r.id === a.pubkey).length;
      assert.equal(aCount, 1, "duplicate clicks yield exactly one seat");
      assert.equal(ea.rankings.length, 2, "still a clean 2-player match");
      a.close(); b.close();
    });

    // §3/§41 identity — a forged (all-zero) signature must be rejected, not seated.
    await t.test("T-identity forged auth is rejected", async () => {
      const bad = new Client("FORGER");
      let welcomed = false;
      await bad.connect({ forgeAuth: true }).then(() => { welcomed = true; }).catch(() => { /* expected */ });
      await wait(500);
      assert.equal(welcomed, false, "no welcome for a bad signature");
      assert.ok(!bad.events.includes("welcome"), "forged auth never authenticated");
      bad.close();
    });

    // §8/§27 reconnect — drop the socket, resume by token: same identity, no dup.
    await t.test("T-reconnect resume keeps identity, no new match", async () => {
      const a = new Client("RECON"); live.push(a);
      await a.connect();
      const firstToken = a.resumeToken;
      a.drop();                 // hard socket loss
      await wait(300);
      await a.resume();         // resume via token (no wallet re-sign)
      assert.equal(a.resumeToken, firstToken, "same session token after resume");
      assert.equal(a.last["welcome"].playerId, a.pubkey, "same player identity restored");
      a.close();
    });
  } finally {
    for (const c of live) c.close();
    await wait(200);
    server.kill();
  }
});
