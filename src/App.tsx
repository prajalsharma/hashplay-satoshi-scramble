/**
 * Satoshi Scramble — GRAB. BANK. ESCAPE.
 * Screens: home (rooms + wallet) · practice (local, labeled) · live match.
 * Money truth is on-chain; gameplay truth is the server; this file renders.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CANVAS_H, CANVAS_W, drawArena, type View } from "./game/renderer";
import { attachInput } from "./game/input";
import { PracticeGame, PRACTICE_SELF } from "./game/practice";
import { GameClient, type NetState } from "./game/net";
import {
  connectWallet, detectWallets, disconnectWallet,
  WALLET_LABELS, type ArchSigner, type WalletKind,
} from "./arch/signer";
import { signAndSend, type TxProgress } from "./arch/txSend";
import { ataOf, decodeTokenAmount, joinMatchIx } from "./arch/program";
import { readAccount } from "./arch/rpc";
import {
  ASSET_MINT_HEX, formatAsset, GAME_WS_URL, NETWORK_LABEL, SCRAMBLE_PROGRAM_ID_HEX,
} from "./arch/config";
import { ENTRY_BASE_UNITS, MATCH_SECONDS, RULESET_VERSION } from "./shared/constants";
import type { RoomInfo } from "./shared/protocol";

const ROSTER: WalletKind[] = ["arch", "xverse", "phantom", "unisat", "leather"];
const ALIAS_KEY = "scramble.alias.v1";

const getAlias = (): string => {
  try {
    const a = localStorage.getItem(ALIAS_KEY);
    if (a) return a;
    const fresh = `HUNTER-${Math.floor(1000 + Math.random() * 9000)}`;
    localStorage.setItem(ALIAS_KEY, fresh);
    return fresh;
  } catch {
    return "HUNTER";
  }
};

type Mode = "home" | "practice" | "live";

export function App() {
  const [mode, setMode] = useState<Mode>("home");
  const [signer, setSigner] = useState<ArchSigner | null>(null);
  const [wallets, setWallets] = useState<WalletKind[]>([]);
  const [modal, setModal] = useState(false);
  const [alias, setAlias] = useState(getAlias);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [walletMsg, setWalletMsg] = useState("");

  // Extensions inject late — re-detect on a backoff and on modal open.
  useEffect(() => {
    setWallets(detectWallets());
    const timers = [400, 1200, 3000].map((ms) => setTimeout(() => setWallets(detectWallets()), ms));
    return () => timers.forEach(clearTimeout);
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!signer) return;
    const acct = await readAccount(ataOf(signer.publicKey));
    setBalance(decodeTokenAmount(acct ? Uint8Array.from(acct.data) : null));
  }, [signer]);

  useEffect(() => {
    void refreshBalance();
    const t = setInterval(() => void refreshBalance(), 8000);
    return () => clearInterval(t);
  }, [refreshBalance]);

  const doConnect = async (kind: WalletKind) => {
    setModal(false);
    setWalletMsg(`CONNECTING ${WALLET_LABELS[kind].toUpperCase()}…`);
    try {
      setSigner(await connectWallet(kind));
      setWalletMsg("");
    } catch (e) {
      setWalletMsg((e as Error).message.toUpperCase().slice(0, 90));
    }
  };

  const logOut = () => {
    if (signer) void disconnectWallet(signer.kind);
    setSigner(null);
    setBalance(null);
  };

  return (
    <div className="shell stack">
      <header className="row spread">
        <div>
          <div className="sub">HASHPLAY / COINUP</div>
          <h1>SATOSHI SCRAMBLE</h1>
          <div className="sub">GRAB. BANK. ESCAPE. · <span className="tag live">{NETWORK_LABEL}</span></div>
        </div>
        <div className="panel" style={{ minWidth: 250, textAlign: "right" }}>
          {signer ? (
            <div className="stack" style={{ gap: 6 }}>
              <div style={{ fontSize: 10 }}>{signer.label}</div>
              <div style={{ fontSize: 12, color: "var(--green)" }}>
                {balance === null ? "…" : formatAsset(balance)}
              </div>
              <div className="note">STAKE ASSET: aBTC · TESTNET · NO REAL VALUE</div>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button className="btn small ghost" onClick={() => setModal(true)}>SWITCH</button>
                <button className="btn small" onClick={logOut}>LOG OUT</button>
              </div>
            </div>
          ) : (
            <button className="btn" onClick={() => { setWallets(detectWallets()); setModal(true); }}>
              CONNECT WALLET
            </button>
          )}
        </div>
      </header>

      {walletMsg && <div className="err">{walletMsg}</div>}

      {modal && (
        <div className="modal-back" onClick={() => setModal(false)}>
          <div className="panel modal stack" onClick={(e) => e.stopPropagation()}>
            <div className="row spread">
              <span style={{ fontSize: 12 }}>CONNECT WALLET</span>
              <button className="btn small ghost" onClick={() => setModal(false)}>✕</button>
            </div>
            {ROSTER.map((k) => {
              const on = wallets.includes(k);
              return (
                <div
                  key={k}
                  className={`wallet-row ${on ? "" : "off"}`}
                  onClick={() => on && void doConnect(k)}
                  title={on ? `Connect ${WALLET_LABELS[k]}` : `Install ${WALLET_LABELS[k]} to connect`}
                >
                  <span>{k === "arch" ? "△ " : ""}{WALLET_LABELS[k].toUpperCase()}</span>
                  <span className={`st ${on ? "on" : ""}`}>{on ? "INSTALLED" : "NOT DETECTED"}</span>
                </div>
              );
            })}
            <div className="note">
              WALLETS SIGN WITH A TAPROOT (P2TR) ADDRESS. NO WALLET? PRACTICE MODE NEEDS NONE.
            </div>
          </div>
        </div>
      )}

      {mode === "home" && (
        <Home
          signer={signer}
          alias={alias}
          onAlias={(a) => { setAlias(a); try { localStorage.setItem(ALIAS_KEY, a); } catch { /* fine */ } }}
          onPractice={() => setMode("practice")}
          onLive={() => setMode("live")}
          onNeedWallet={() => setModal(true)}
        />
      )}
      {mode === "practice" && <Practice alias={alias} onExit={() => setMode("home")} />}
      {mode === "live" && signer && (
        <Live signer={signer} alias={alias} onExit={() => setMode("home")} onBalance={refreshBalance} />
      )}

      <footer className="row spread">
        <span className="note">{RULESET_VERSION} · PROVABLY ACCOUNTED · WINNERS PAID ON-CHAIN · {NETWORK_LABEL}</span>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Home: how to play + rooms
// ---------------------------------------------------------------------------

function Home(props: {
  signer: ArchSigner | null;
  alias: string;
  onAlias: (a: string) => void;
  onPractice: () => void;
  onLive: () => void;
  onNeedWallet: () => void;
}) {
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [serverUp, setServerUp] = useState<boolean | null>(null);

  useEffect(() => {
    const httpBase = GAME_WS_URL.replace(/^ws/, "http");
    const poll = async () => {
      try {
        const res = await fetch(`${httpBase}/rooms`, { signal: AbortSignal.timeout(4000) });
        const json = (await res.json()) as { rooms: RoomInfo[] };
        setRooms(json.rooms);
        setServerUp(true);
      } catch {
        setServerUp(false);
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="stack">
      <div className="panel stack">
        <div style={{ fontSize: 12, color: "var(--gold)" }}>HOW TO PLAY</div>
        <div className="note" style={{ fontSize: 9 }}>
          1. UP TO 8 HUNTERS SHARE ONE ARENA FOR {MATCH_SECONDS} SECONDS.<br />
          2. GRAB LOOT — IT GOES TO “CARRYING”, AND CARRYING IS NOT SAFE.<br />
          3. RUN IT TO THE BANK ZONE — BANKED LOOT CAN NEVER BE TAKEN.<br />
          4. BUMP A RICHER HUNTER AND HALF THEIR CARRY SPILLS ON THE FLOOR.<br />
          5. A GIANT CACHE DROPS WITH 20 SECONDS LEFT. ONE MORE RUN?<br />
          6. MOST BANKED WINS. ENTRY {formatAsset(ENTRY_BASE_UNITS)} EACH — TOP 3 SPLIT THE POT
          70/20/10 (WINNER TAKES ALL UNDER 4 PLAYERS). CONTROLS: WASD / ARROWS.
        </div>
      </div>

      <div className="row spread">
        <div className="row">
          <span style={{ fontSize: 10 }}>YOU ARE {props.alias}</span>
          <button
            className="btn small ghost"
            onClick={() => {
              const n = window.prompt("Pick a hunter name (max 20)", props.alias);
              if (n?.trim()) props.onAlias(n.trim().slice(0, 20).toUpperCase());
            }}
          >
            ✎
          </button>
        </div>
        <button className="btn ghost" onClick={props.onPractice}>🕹 PRACTICE (NO WALLET)</button>
      </div>

      <div className="panel stack">
        <div className="row spread">
          <span style={{ fontSize: 12 }}>PUBLIC ROOMS</span>
          <span className={`tag ${serverUp ? "live" : "warn"}`}>
            {serverUp === null ? "…" : serverUp ? "SERVER ONLINE" : "SERVER OFFLINE"}
          </span>
        </div>
        {serverUp === false && (
          <div className="note">
            THE GAME SERVER IS UNREACHABLE — LIVE ROOMS NEED IT. PRACTICE MODE STILL WORKS.
          </div>
        )}
        {rooms.map((r) => (
          <div key={r.room} className="row spread" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <div>
              <div style={{ fontSize: 11 }}>{r.room}</div>
              <div className="note">
                {r.players} / {r.capacity} · ENTRY {formatAsset(BigInt(r.entryBaseUnits))} · {String(r.state).toUpperCase()}
              </div>
            </div>
            <button
              className="btn green"
              disabled={!serverUp || r.players >= r.capacity || r.state === "live" || r.state === "countdown"}
              onClick={() => (props.signer ? props.onLive() : props.onNeedWallet())}
            >
              {r.players >= r.capacity ? "FULL" : "JOIN"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HUD + arena canvas (shared by practice and live)
// ---------------------------------------------------------------------------

function ArenaView(props: {
  getView: (nowMs: number) => View;
  selfId: string;
  overlay?: React.ReactNode;
  leaderboard: { id: string; alias: string; banked: string; rank: number }[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState({ banked: "0", carrying: "0", time: 0, phase: "" });

  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      const view = props.getView(now);
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) drawArena(ctx, view, now);
      const self = view.players.find((p) => p.isSelf || p.id === props.selfId);
      setHud({
        banked: self ? self.banked.toString() : "0",
        carrying: self ? self.carrying.toString() : "0",
        time: Math.max(0, Math.ceil(view.timeLeft)),
        phase: view.phase,
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [props]);

  return (
    <div className="stack">
      <div className="hud">
        <span>BANKED <b>{hud.banked}</b></span>
        <span className="carrying">CARRYING {hud.carrying}{hud.carrying !== "0" ? " ⚠" : ""}</span>
        <span className={`timer ${hud.time <= 10 && hud.phase === "live" ? "hot" : ""}`}>
          {String(Math.floor(hud.time / 60)).padStart(2, "0")}:{String(hud.time % 60).padStart(2, "0")}
        </span>
        <span className="note">PLAYERS {props.leaderboard.length || "…"}</span>
      </div>
      <div className="arena-wrap">
        <canvas ref={canvasRef} className="arena" width={CANVAS_W} height={CANVAS_H} />
        {props.overlay}
      </div>
      <div className="panel board">
        {props.leaderboard.map((r) => (
          <div key={r.id} className={`row spread ${r.id === props.selfId ? "you" : ""}`}>
            <span>#{r.rank} {r.alias.toUpperCase()}{r.id === props.selfId ? " (YOU)" : ""}</span>
            <span>{r.banked}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Practice mode — labeled, local, honest
// ---------------------------------------------------------------------------

function Practice(props: { alias: string; onExit: () => void }) {
  const gameRef = useRef<PracticeGame | null>(null);
  if (!gameRef.current) gameRef.current = new PracticeGame(props.alias);
  const game = gameRef.current;
  const [board, setBoard] = useState(game.leaderboard());
  const [done, setDone] = useState(false);

  useEffect(() => attachInput((m) => game.setMask(m)), [game]);
  useEffect(() => {
    const t = setInterval(() => {
      setBoard(game.leaderboard());
      if (game.sim.phase === "ended") setDone(true);
    }, 500);
    return () => clearInterval(t);
  }, [game]);

  const overlay = done ? (
    <div className="overlay">
      <div className="big">#{board.find((r) => r.id === PRACTICE_SELF)?.rank ?? "-"}</div>
      <div style={{ fontSize: 11 }}>{board.find((r) => r.id === PRACTICE_SELF)?.banked ?? 0} BANKED · PRACTICE ONLY</div>
      <button className="btn" onClick={() => { gameRef.current = new PracticeGame(props.alias); setDone(false); }}>
        RUN IT BACK
      </button>
      <button className="btn ghost" onClick={props.onExit}>EXIT PRACTICE</button>
    </div>
  ) : game.sim.phase === "countdown" ? (
    <div className="overlay"><div className="big">{Math.ceil(game.sim.timeLeft)}</div><div className="sub">SCRAMBLE!</div></div>
  ) : undefined;

  return (
    <div className="stack">
      <div className="row spread">
        <span className="tag warn">PRACTICE MODE · LOCAL BOTS · NOTHING REAL AT STAKE</span>
        <button className="btn small ghost" onClick={props.onExit}>← EXIT</button>
      </div>
      <ArenaView getView={(now) => gameRef.current!.frame(now)} selfId={PRACTICE_SELF} overlay={overlay} leaderboard={board} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live mode — real wallet, real chain, real players
// ---------------------------------------------------------------------------

function Live(props: { signer: ArchSigner; alias: string; onExit: () => void; onBalance: () => void }) {
  const [net, setNet] = useState<NetState | null>(null);
  const clientRef = useRef<GameClient | null>(null);
  const [tx, setTx] = useState<TxProgress>({ phase: "idle" });
  const [joinBusy, setJoinBusy] = useState(false);
  const [debug, setDebug] = useState(false);

  useEffect(() => {
    const c = new GameClient(props.signer, props.alias, setNet);
    clientRef.current = c;
    c.connect();
  }, [props.signer, props.alias]);

  useEffect(() => attachInput((m) => clientRef.current?.setMask(m)), []);

  const c = clientRef.current;
  const phase = net?.phase ?? "connecting";

  const payEntry = async () => {
    if (!c || !net?.matchId) return;
    setJoinBusy(true);
    try {
      await signAndSend(props.signer, [joinMatchIx(props.signer.publicKey, BigInt(net.matchId))], setTx);
      props.onBalance();
      c.ready();
    } catch (e) {
      setTx({ phase: "failed", error: (e as Error).message });
    } finally {
      setJoinBusy(false);
    }
  };

  const selfRank = net?.rankings?.find((r) => r.id === props.signer.publicKeyHex);

  const overlay =
    phase === "countdown" ? (
      <div className="overlay"><div className="big">GET READY</div></div>
    ) : phase === "ended" && net?.rankings ? (
      <div className="overlay">
        <div className="big">#{selfRank?.rank ?? "-"}</div>
        <div style={{ fontSize: 11 }}>{selfRank?.banked ?? 0} BANKED</div>
        {net.settlement && (
          <div className={net.settlement.state === "confirmed" ? "ok" : "note"}>
            {net.settlement.state === "pending" && "PAYOUT PENDING — SETTLING ON ARCH…"}
            {net.settlement.state === "confirmed" && `SETTLEMENT CONFIRMED${net.settlement.txid ? ` · TX ${net.settlement.txid.slice(0, 10)}…` : ""}`}
            {net.settlement.state === "failed" && "SETTLEMENT FAILED — ENTRIES RECLAIMABLE AFTER THE DEADLINE"}
          </div>
        )}
        <button className="btn" onClick={props.onExit}>BACK TO ROOMS</button>
      </div>
    ) : undefined;

  return (
    <div className="stack">
      <div className="row spread">
        <span className="tag live">{NETWORK_LABEL} · LIVE · REAL TRANSACTIONS</span>
        <button className="btn small ghost" onClick={props.onExit}>← ROOMS</button>
      </div>

      {phase === "connecting" && <div className="note">CONNECTING TO GAME SERVER…</div>}
      {phase === "authing" && <div className="note">SIGN THE SESSION CHALLENGE IN YOUR WALLET (PROVES SEAT OWNERSHIP — MOVES NO FUNDS)</div>}

      {phase === "rooms" && (
        <div className="panel stack">
          <span style={{ fontSize: 11 }}>PICK A ROOM</span>
          {net?.rooms.map((r) => (
            <div key={r.room} className="row spread">
              <span className="note">{r.room} · {r.players}/{r.capacity} · ENTRY {formatAsset(BigInt(r.entryBaseUnits))}</span>
              <button className="btn small green" onClick={() => c?.joinRoom(r.room)}>JOIN</button>
            </div>
          ))}
        </div>
      )}

      {phase === "joining" && (
        <div className="panel stack">
          <span style={{ fontSize: 11 }}>ENTRY: {formatAsset(ENTRY_BASE_UNITS)}</span>
          <div className="note">
            YOUR ENTRY GOES INTO THE MATCH VAULT ON ARCH. WINNERS ARE PAID FROM IT
            AUTOMATICALLY; IF THE MATCH NEVER SETTLES YOU CAN RECLAIM IT ON-CHAIN.
          </div>
          <button className="btn" disabled={joinBusy} onClick={() => void payEntry()}>
            {joinBusy ? tx.phase.toUpperCase() + "…" : `PAY ENTRY · ${formatAsset(ENTRY_BASE_UNITS)}`}
          </button>
          {tx.phase === "failed" && <div className="err">{(tx.error ?? "TRANSACTION FAILED").toUpperCase().slice(0, 120)}</div>}
        </div>
      )}

      {phase === "lobby" && (
        <div className="panel stack">
          <span style={{ fontSize: 11 }}>WAITING FOR HUNTERS…</span>
          {net?.lobbyPlayers.map((p) => (
            <div key={p.id} className="note">
              {p.alias.toUpperCase()} {p.joined ? "· ENTRY PAID ✓" : "· PAYING…"}
            </div>
          ))}
          <div className="note">MATCH STARTS WHEN THE ROOM FILLS OR THE 30S WINDOW CLOSES (MIN 2).</div>
        </div>
      )}

      {(phase === "countdown" || phase === "live" || phase === "ended") && c && (
        <ArenaView
          getView={(now) => c.view(now)}
          selfId={props.signer.publicKeyHex}
          overlay={overlay}
          leaderboard={net?.leaderboard ?? []}
        />
      )}

      {net?.error && phase !== "ended" && <div className="err">{net.error}</div>}

      <button className="btn small ghost" onClick={() => setDebug(!debug)}>[{debug ? "-" : "+"}] DEBUG</button>
      {debug && (
        <div className="panel debug">
          NETWORK: {NETWORK_LABEL} · SERVER: {GAME_WS_URL} · LATENCY: {net?.latencyMs ?? "—"}MS<br />
          WALLET: {props.signer.label} ({props.signer.publicKeyHex.slice(0, 16)}…)<br />
          PROGRAM: {SCRAMBLE_PROGRAM_ID_HEX || "(unset)"} · ASSET: {ASSET_MINT_HEX.slice(0, 16)}…<br />
          ROOM: {net?.room ?? "—"} · MATCH: {net?.matchId ?? "—"} · TICK: {net?.tick ?? 0} · RULESET: {RULESET_VERSION}<br />
          RESULT HASH: {net?.resultHash ?? "—"}<br />
          SETTLEMENT: {net?.settlement ? `${net.settlement.state} ${net.settlement.txid ?? ""}` : "—"}<br />
          LAST TX: {tx.txid ?? "—"} ({tx.phase})
        </div>
      )}
    </div>
  );
}
