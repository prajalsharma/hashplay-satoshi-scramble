/**
 * Satoshi Scramble realtime server — WS + tiny HTTP on one port.
 * Session auth: BIP-322 challenge over a fresh nonce binds the socket to a
 * wallet pubkey (docs/SECURITY.md). Rooms are public; money is on-chain.
 */

import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { parseClientMsg, enc, loginMessage, type ServerMsg } from "../../src/shared/protocol";
import { PROTOCOL_VERSION } from "../../src/shared/protocol";
import { verifyChallengeBip322 } from "../../src/arch/bip322";
import { chainEnabled, ensureServerFunded, newNonceHex, newTokenHex, serverSigner } from "./chain";
import { Room, type Session } from "./room";

const PORT = Number(process.env.PORT ?? 8890);
const HOST = process.env.HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",").map((s) => s.trim()).filter(Boolean);

const rooms = new Map<string, Room>(
  ["ROOM-01", "ROOM-02", "ROOM-03"].map((id) => [id, new Room(id)]),
);
const sessionsByToken = new Map<string, Session>();

type ConnState = {
  nonceHex: string;
  pendingPubkey: string | null;
  pendingAlias: string;
  session: Session | null;
  msgTimestamps: number[];
};

const http = createServer((req, res) => {
  const origin = req.headers.origin ?? "";
  if (CORS_ORIGINS.includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
  }
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true, service: "satoshi-scramble-server", protocol: PROTOCOL_VERSION,
      chain: chainEnabled(), rooms: rooms.size,
    }));
    return;
  }
  if (req.url === "/rooms") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ rooms: [...rooms.values()].map((r) => r.info()) }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: http, path: "/ws" });

wss.on("connection", (ws: WebSocket, req) => {
  const origin = req.headers.origin;
  if (origin && !CORS_ORIGINS.includes(origin)) {
    ws.close(4003, "origin not allowed");
    return;
  }
  const state: ConnState = {
    nonceHex: newNonceHex(),
    pendingPubkey: null,
    pendingAlias: "PLAYER",
    session: null,
    msgTimestamps: [],
  };
  send(ws, { s: "challenge", nonceHex: state.nonceHex, protocol: PROTOCOL_VERSION });

  ws.on("message", (raw) => {
    // Global rate cap: 40 msgs / sliding second per connection.
    const now = Date.now();
    state.msgTimestamps = state.msgTimestamps.filter((t) => now - t < 1000);
    if (state.msgTimestamps.length >= 40) return;
    state.msgTimestamps.push(now);

    const msg = parseClientMsg(String(raw));
    if (!msg) {
      send(ws, { s: "error", code: "bad_msg", message: "malformed message" });
      return;
    }

    switch (msg.c) {
      case "hello": {
        state.pendingPubkey = msg.pubkey;
        state.pendingAlias = msg.alias.trim().slice(0, 20) || "PLAYER";
        return;
      }
      case "auth": {
        if (!state.pendingPubkey) {
          send(ws, { s: "error", code: "no_hello", message: "send hello first" });
          return;
        }
        const pub = Uint8Array.from(Buffer.from(state.pendingPubkey, "hex"));
        // Verify the SIWE-style readable login message (not a raw hash).
        const challenge = new TextEncoder().encode(loginMessage(state.nonceHex));
        const sig = Uint8Array.from(Buffer.from(msg.sig64Hex, "hex"));
        if (!verifyChallengeBip322(pub, challenge, sig)) {
          send(ws, { s: "error", code: "auth_failed", message: "signature did not verify" });
          ws.close(4001, "auth failed");
          return;
        }
        const session: Session = {
          ws, pubkey: state.pendingPubkey, alias: state.pendingAlias,
          resumeToken: newTokenHex(), room: null, joinedOnChain: false,
          inputTimestamps: [], disconnectedAt: null,
        };
        state.session = session;
        sessionsByToken.set(session.resumeToken, session);
        send(ws, { s: "welcome", playerId: session.pubkey, resumeToken: session.resumeToken });
        send(ws, { s: "rooms", rooms: [...rooms.values()].map((r) => r.info()) });
        return;
      }
      case "resume": {
        const session = sessionsByToken.get(msg.resumeToken);
        if (!session) {
          send(ws, { s: "error", code: "bad_resume", message: "unknown resume token" });
          return;
        }
        state.session = session;
        session.room?.handleResume(session, ws) ?? ((session.ws = ws), send(ws, {
          s: "welcome", playerId: session.pubkey, resumeToken: session.resumeToken,
        }));
        return;
      }
      case "ping":
        send(ws, { s: "pong", t: msg.t });
        return;
    }

    const session = state.session;
    if (!session) {
      send(ws, { s: "error", code: "unauth", message: "authenticate first" });
      return;
    }

    switch (msg.c) {
      case "join_room": {
        const room = rooms.get(msg.room);
        if (!room) {
          send(ws, { s: "error", code: "no_room", message: "unknown room" });
          return;
        }
        void room
          .requestJoin(session)
          .then(({ matchId, matchPdaHex }) => {
            send(ws, { s: "join_ok", room: room.id, matchId, matchPda: matchPdaHex });
            room.broadcastRoomState();
          })
          .catch((e: Error) => send(ws, { s: "error", code: "join", message: e.message }));
        return;
      }
      case "ready": {
        const room = session.room;
        if (!room) {
          send(ws, { s: "error", code: "no_room", message: "join a room first" });
          return;
        }
        void room
          .confirmReady(session)
          .catch((e: Error) => send(ws, { s: "error", code: "ready", message: e.message }));
        return;
      }
      case "input": {
        session.room?.handleInput(session, msg.seq, msg.mask);
        return;
      }
    }
  });

  ws.on("close", () => {
    state.session?.room?.handleDisconnect(state.session);
    if (state.session) state.session.ws = null;
  });
});

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === ws.OPEN) ws.send(enc(msg));
}

async function main(): Promise<void> {
  if (chainEnabled()) {
    const s = serverSigner();
    console.log(`[server] settlement authority: ${s.publicKeyHex.slice(0, 12)}…`);
    await ensureServerFunded();
  } else {
    console.log("[server] CHAIN DISABLED (no SCRAMBLE_PROGRAM_ID)" +
      (process.env.GAME_DEV_FREEJOIN === "1" ? " — dev freejoin ON" : ""));
  }
  http.listen(PORT, HOST, () => {
    console.log(`[server] satoshi-scramble on http://${HOST}:${PORT} (ws /ws) · rooms: ${[...rooms.keys()].join(", ")}`);
  });
}

void main();
