/**
 * Satoshi Scramble — GRAB. BANK. ESCAPE.
 * Screens: home (rooms + wallet) · practice (local, labeled) · live match.
 * Money truth is on-chain; gameplay truth is the server; this file renders.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CANVAS_H, CANVAS_W, drawArena, type View } from "./game/renderer";
import { attachInput } from "./game/input";
import { PracticeGame, PRACTICE_SELF, type Difficulty } from "./game/practice";
import { GameClient, type NetState } from "./game/net";
import {
  connectWallet, detectWallets, disconnectWallet, silentArch,
  WALLET_LABELS, type ArchSigner, type WalletKind,
} from "./arch/signer";
import { signAndSend, type TxProgress } from "./arch/txSend";
import { ataOf, decodeTokenAmount, joinMatchIx } from "./arch/program";
import { readAccount } from "./arch/rpc";
import {
  ASSET_MINT_HEX, explorerTxUrl, formatAsset, GAME_WS_URL, NETWORK_LABEL, SCRAMBLE_PROGRAM_ID_HEX,
} from "./arch/config";
import { ENTRY_BASE_UNITS, MATCH_SECONDS, MAX_PLAYERS, MIN_PLAYERS, RULESET_VERSION } from "./shared/constants";
import type { RoomInfo } from "./shared/protocol";

const ROSTER: WalletKind[] = ["arch", "xverse", "phantom", "unisat", "leather"];
const ALIAS_KEY = "scramble.alias.v1";

/**
 * Read a previously-chosen practice name; DO NOT invent/persist one on page
 * load (standard web3: no identity before the user acts). `ensureAlias`
 * lazily mints one only when a name is actually needed (entering practice).
 */
const readAlias = (): string => {
  try { return localStorage.getItem(ALIAS_KEY) ?? ""; } catch { return ""; }
};
const ensureAlias = (): string => {
  const existing = readAlias();
  if (existing) return existing;
  const fresh = `HUNTER-${Math.floor(1000 + Math.random() * 9000)}`;
  try { localStorage.setItem(ALIAS_KEY, fresh); } catch { /* ephemeral */ }
  return fresh;
};

// --- Match history (§46): per-browser record of matches this wallet played ---
const HISTORY_KEY = "scramble.history.v1";
type HistoryEntry = {
  matchId: string; pda: string | null; room: string; stakeBase: string; ts: number;
  players?: number; myRank?: number; resultHash?: string;
  settleTxid?: string; settleState?: string;
};
const readHistory = (): HistoryEntry[] => {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") as HistoryEntry[]; }
  catch { return []; }
};
const upsertHistory = (e: Partial<HistoryEntry> & { matchId: string }): void => {
  try {
    const all = readHistory();
    const i = all.findIndex((h) => h.matchId === e.matchId);
    if (i >= 0) all[i] = { ...all[i], ...e };
    else all.unshift(e as HistoryEntry);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(all.slice(0, 25)));
  } catch { /* history is best-effort */ }
};

type Mode = "home" | "practice" | "live";

export function App() {
  const [mode, setMode] = useState<Mode>("home");
  const [signer, setSigner] = useState<ArchSigner | null>(null);
  const [wallets, setWallets] = useState<WalletKind[]>([]);
  const [modal, setModal] = useState(false);
  const [alias, setAlias] = useState(readAlias);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [walletMsg, setWalletMsg] = useState("");

  // Extensions inject late — re-detect on a backoff and on modal open.
  useEffect(() => {
    setWallets(detectWallets());
    const timers = [400, 1200, 3000].map((ms) => setTimeout(() => setWallets(detectWallets()), ms));
    return () => timers.forEach(clearTimeout);
  }, []);

  // Silent restore: if already connected to the Arch Wallet, rebuild the signer
  // WITHOUT opening any popup — so a reload never re-triggers its connect window.
  useEffect(() => {
    let cancelled = false;
    const restore = () => { if (!signer) void silentArch().then((s) => { if (s && !cancelled) setSigner(s); }); };
    restore();
    const timers = [600, 1800].map((ms) => setTimeout(restore, ms)); // extension injects late
    return () => { cancelled = true; timers.forEach(clearTimeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Invite deep-link: ?room=… with a connected wallet drops straight into live
  // mode; the Live view then auto-joins that room. (Connect first if no wallet.)
  useEffect(() => {
    const room = new URLSearchParams(location.search).get("room");
    if (room && signer && mode === "home") setMode("live");
  }, [signer, mode]);

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
    <div className="shell">
      <header className="marquee">
        <div>
          <div className="brand-kicker">ARCADE · GRAB · BANK · ESCAPE</div>
          <h1 className="title"><span className="swords">⚔</span> SATOSHI SCRAMBLE</h1>
          <div className="tagline">
            LOOT THE ARENA — NOTHING'S YOURS UNTIL YOU BANK IT ·{" "}
            <span className="tag hot">{NETWORK_LABEL} · NO REAL VALUE</span>
          </div>
        </div>
        <div className="chip">
          {signer ? (
            <>
              <div className="who">{signer.label.toUpperCase()}</div>
              <div className="bal">{balance === null ? "…" : formatAsset(balance)}</div>
              <div className="asset">aBTC · TESTNET · TEST FUNDS ONLY</div>
              <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
                <button className="btn small ghost" onClick={() => setModal(true)}>SWITCH</button>
                <button className="btn small" onClick={logOut}>LOG OUT</button>
              </div>
            </>
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
          <div className="panel accent modal stack" onClick={(e) => e.stopPropagation()}>
            <div className="row spread">
              <span style={{ fontSize: 13, color: "var(--gold)" }}>CONNECT WALLET</span>
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
                  <span>{k === "arch" ? "△ " : ""}{WALLET_LABELS[k].toUpperCase()}{k === "unisat" ? " · SMOOTHEST" : ""}</span>
                  <span className={`st ${on ? "on" : ""}`}>{on ? "INSTALLED" : "NOT DETECTED"}</span>
                </div>
              );
            })}
            <div className="note">
              TIP: <b>UNISAT / XVERSE</b> SIGN INLINE — ONE POPUP, NOTHING TO CLOSE. THE ARCH WALLET,
              WHEN LINKED TO AN EXTERNAL WALLET, OPENS AN "ARCH WALLET · CONNECT" RELAY WINDOW THAT ITS
              EXTENSION CLOSES ON ITS OWN (APPROVE IN YOUR EXTERNAL WALLET; IT AUTO-CLOSES, ~90S WORST CASE).
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
      {mode === "practice" && <Practice alias={alias || ensureAlias()} onExit={() => setMode("home")} />}
      {mode === "live" && signer && (
        <Live
          signer={signer}
          alias={alias || signer.label}
          onExit={() => setMode("home")}
          onBalance={refreshBalance}
        />
      )}

      <footer className="row spread">
        <span className="foot">{RULESET_VERSION} · PROVABLY ACCOUNTED · WINNERS PAID ON-CHAIN · {NETWORK_LABEL} · NO REAL VALUE</span>
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
  const [history] = useState(readHistory);
  const [serverUp, setServerUp] = useState<boolean | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameVal, setRenameVal] = useState("");

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

  const HOW = [
    <>UP TO <b>8 HUNTERS</b> SHARE ONE ARENA FOR {MATCH_SECONDS} SECONDS.</>,
    <>GRAB LOOT → IT'S <b>CARRYING</b>, AND CARRYING IS NOT SAFE.</>,
    <>RUN IT TO THE <b>BANK</b> ZONE → BANKED LOOT CAN NEVER BE TAKEN.</>,
    <>BUMP A RICHER HUNTER AND <b>HALF THEIR CARRY SPILLS</b> ON THE FLOOR.</>,
    <>A <b>GIANT CACHE</b> DROPS WITH 20 SECONDS LEFT. ONE MORE RUN?</>,
    <>MOST BANKED WINS. ENTRY <b>{formatAsset(ENTRY_BASE_UNITS)}</b> — TOP 3 SPLIT 70/20/10 (WINNER TAKES ALL UNDER 4). CONTROLS: <b>WASD / ARROWS</b>.</>,
  ];
  const commitRename = () => {
    const n = renameVal.trim().slice(0, 20).toUpperCase();
    if (n) props.onAlias(n);
    setRenameOpen(false);
  };
  return (
    <div className="grid-2 home-fill">
      {renameOpen && (
        <div className="modal-back" onClick={() => setRenameOpen(false)}>
          <div className="modal stack" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 13, color: "var(--orange)" }}>DISPLAY NAME</div>
            <div className="label">PRACTICE NAME · MAX 20</div>
            <input
              className="pix"
              autoFocus
              maxLength={20}
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenameOpen(false);
              }}
            />
            <div className="actions">
              <button className="btn small ghost" onClick={() => setRenameOpen(false)}>CANCEL</button>
              <button className="btn small" onClick={commitRename}>SAVE</button>
            </div>
          </div>
        </div>
      )}
      <div className="panel accent stack">
        <div style={{ fontSize: 13, color: "var(--gold)" }}>HOW TO PLAY</div>
        <div className="steps">
          {HOW.map((t, i) => (
            <div className="step" key={i}>
              <span className="n">{i + 1}</span>
              <span className="t">{t}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="stack">

      <div className="row spread">
        <div className="row">
          {props.signer ? (
            <span style={{ fontSize: 10 }}>PLAYING AS {props.signer.label}</span>
          ) : (
            <span className="note">CONNECT A WALLET TO PLAY LIVE · OR JUST PRACTICE →</span>
          )}
        </div>
        <div className="row">
          {(props.alias || "") && (
            <button
              className="btn small ghost"
              title="Your practice display name"
              onClick={() => { setRenameVal(props.alias); setRenameOpen(true); }}
            >
              ✎ {props.alias}
            </button>
          )}
          <button className="btn ghost" onClick={props.onPractice}>🕹 PRACTICE (NO WALLET)</button>
        </div>
      </div>

      <div className="panel stack">
        <div className="row spread">
          <span style={{ fontSize: 13, color: "var(--orange)" }}>PUBLIC ROOMS</span>
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
          <div key={r.room} className="room">
            <div>
              <div className="rname">{r.room}</div>
              <div className="rmeta">
                {r.players}/{r.capacity} · {formatAsset(BigInt(r.entryBaseUnits))} · {String(r.state).toUpperCase()}
              </div>
            </div>
            <button
              className="btn green small"
              disabled={!serverUp || r.players >= r.capacity || r.state === "live" || r.state === "countdown"}
              onClick={() => (props.signer ? props.onLive() : props.onNeedWallet())}
            >
              {r.players >= r.capacity ? "FULL" : "JOIN"}
            </button>
          </div>
        ))}
      </div>

      {history.length > 0 && (
        <div className="panel stack">
          <span style={{ fontSize: 13, color: "var(--orange)" }}>YOUR MATCHES</span>
          {history.slice(0, 8).map((h) => {
            const result = h.myRank == null ? "PENDING"
              : h.myRank === 0 ? "1ST · WON"
              : h.myRank === 1 ? "2ND" : h.myRank === 2 ? "3RD" : `${h.myRank + 1}TH`;
            return (
              <div key={h.matchId} className="room">
                <div>
                  <div className="rname">{h.room || "MATCH"} · {result}</div>
                  <div className="rmeta">
                    STAKE {formatAsset(BigInt(h.stakeBase))} · {h.players ?? "?"}P · {new Date(h.ts).toLocaleDateString()} {new Date(h.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {h.settleTxid
                      ? <> · <a href={explorerTxUrl(h.settleTxid)} target="_blank" rel="noreferrer" style={{ color: "var(--green)" }}>SETTLED ↗</a></>
                      : h.settleState ? ` · ${h.settleState.toUpperCase()}` : ""}
                  </div>
                </div>
              </div>
            );
          })}
          <div className="note" style={{ fontSize: 9 }}>STORED IN THIS BROWSER · VERIFY ANY MATCH ON-CHAIN VIA ITS SETTLEMENT LINK</div>
        </div>
      )}
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
    <div className="grid-2">
      <div className="stack">
        <div className="hud">
          <span className="stat bank">BANKED <b>{hud.banked}</b></span>
          <span className="stat carry">CARRYING <b>{hud.carrying}{hud.carrying !== "0" ? " ⚠" : ""}</b></span>
          <span className={`stat time ${hud.time <= 10 && hud.phase === "live" ? "hot" : ""}`}>
            TIME <b>{String(Math.floor(hud.time / 60)).padStart(2, "0")}:{String(hud.time % 60).padStart(2, "0")}</b>
          </span>
          <span className="stat">HUNTERS <b>{props.leaderboard.length || "…"}</b></span>
        </div>
        <div className="cabinet">
          <div className="arena-wrap">
            <canvas ref={canvasRef} className="arena" width={CANVAS_W} height={CANVAS_H} />
            {props.overlay}
          </div>
        </div>
      </div>
      <div className="panel accent board">
        <div style={{ fontSize: 12, color: "var(--gold)", marginBottom: 6 }}>LEADERBOARD</div>
        {props.leaderboard.length === 0 && <div className="note">WAITING FOR THE SCRAMBLE…</div>}
        {props.leaderboard.map((r) => (
          <div key={r.id} className={`lb ${r.id === props.selfId ? "you" : ""}`}>
            <span><span className="rk">#{r.rank}</span>{r.alias.toUpperCase()}{r.id === props.selfId ? " (YOU)" : ""}</span>
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
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const gameRef = useRef<PracticeGame | null>(null);
  if (!gameRef.current) gameRef.current = new PracticeGame(props.alias, difficulty);
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
      <button className="btn" onClick={() => { gameRef.current = new PracticeGame(props.alias, difficulty); setDone(false); }}>
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
        <span className="tag warn">PRACTICE · LOCAL BOTS · NOTHING AT STAKE</span>
        <div className="row" style={{ gap: 6 }}>
          <span className="note" style={{ fontSize: 9 }}>BOTS (RESTARTS):</span>
          {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
            <button key={d} className={`btn small ${difficulty === d ? "green" : "ghost"}`}
              onClick={() => { if (d !== difficulty) { setDifficulty(d); gameRef.current = new PracticeGame(props.alias, d); setDone(false); } }}
              title={`${d} bots — starts a fresh round`}>
              {d.toUpperCase()}
            </button>
          ))}
          <button className="btn small ghost" onClick={props.onExit}>← EXIT</button>
        </div>
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

  // Shareable invite: ?room=ROOM-01 deep-links a friend straight to that room.
  const inviteRoom = typeof location !== "undefined"
    ? new URLSearchParams(location.search).get("room")
    : null;
  const autoJoined = useRef(false);
  const [copied, setCopied] = useState("");
  useEffect(() => {
    if (!autoJoined.current && inviteRoom && phase === "rooms" &&
        net?.rooms.some((r) => r.room === inviteRoom)) {
      autoJoined.current = true;
      c?.joinRoom(inviteRoom);
    }
  }, [phase, net, inviteRoom, c]);
  const copyInvite = (room: string) => {
    const url = `${location.origin}${location.pathname}?room=${room}`;
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(room);
      setTimeout(() => setCopied(""), 2000);
    });
  };

  // Lobby: how many more paid players are needed before the match can start.
  const paidCount = net?.lobbyPlayers.filter((p) => p.joined).length ?? 0;

  // Waiting-room (pre-stake): ready-up + chat + payout preview.
  const selfId = props.signer.publicKeyHex;
  const selfRow = net?.lobbyPlayers.find((p) => p.id === selfId);
  const selfReady = selfRow?.ready ?? false;
  const selfStaked = selfRow?.joined ?? false;
  const here = net?.lobbyPlayers?.length ?? 1;
  const readyCount = net?.lobbyPlayers.filter((p) => p.ready || p.joined).length ?? 0;
  const stakingUnlocked = readyCount >= MIN_PLAYERS;
  const needPlayers = Math.max(0, MIN_PLAYERS - here);          // more must JOIN
  const notReadyHere = here - readyCount;                        // present but not ready
  const [chatInput, setChatInput] = useState("");
  const [practiceWait, setPracticeWait] = useState(false);
  const projected = Math.max(paidCount, readyCount, MIN_PLAYERS);
  const projPot = ENTRY_BASE_UNITS * BigInt(projected);
  const projWinner = projected < 4 ? projPot : (projPot * 70n) / 100n;

  // Record match outcome + settlement into local history (§46).
  useEffect(() => {
    if (phase === "ended" && net?.matchId && net.rankings) {
      const mine = net.rankings.find((r) => r.id === props.signer.publicKeyHex);
      upsertHistory({ matchId: net.matchId, players: net.rankings.length,
        myRank: mine?.rank, resultHash: net.resultHash ?? undefined });
    }
  }, [phase, net?.matchId, net?.rankings, net?.resultHash, props.signer.publicKeyHex]);
  useEffect(() => {
    if (net?.matchId && net?.settlement) {
      upsertHistory({ matchId: net.matchId, settleTxid: net.settlement.txid, settleState: net.settlement.state });
    }
  }, [net?.matchId, net?.settlement]);

  const payEntry = async () => {
    if (!c || !net?.matchId) return;
    setJoinBusy(true);
    try {
      // Check the wallet holds the entry before signing — a clear message
      // beats a raw on-chain failure when the balance is short.
      const acct = await readAccount(ataOf(props.signer.publicKey));
      const bal = decodeTokenAmount(acct ? Uint8Array.from(acct.data) : null);
      if (bal < ENTRY_BASE_UNITS) {
        setTx({ phase: "failed", error: `NOT ENOUGH aBTC — ENTRY IS ${formatAsset(ENTRY_BASE_UNITS)}, THIS WALLET HAS ${formatAsset(bal)}.` });
        return;
      }
      await signAndSend(props.signer, [joinMatchIx(props.signer.publicKey, BigInt(net.matchId))], setTx);
      props.onBalance();
      c.ready();
      upsertHistory({ matchId: net.matchId, pda: net.matchPdaHex, room: net.room ?? "",
        stakeBase: ENTRY_BASE_UNITS.toString(), ts: Date.now() });
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
        {net.hashVerified === true && <div className="ok" style={{ fontSize: 10 }}>RESULT VERIFIED ON-CHAIN ✓</div>}
        {net.hashVerified === false && <div className="err" style={{ fontSize: 10 }}>⚠ RESULT DOES NOT MATCH ON-CHAIN RECORD</div>}
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" onClick={() => c?.leaveToRooms()}>PLAY AGAIN</button>
          <button className="btn ghost" onClick={props.onExit}>BACK TO ROOMS</button>
        </div>
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
          <div className="note">NEEDS {MIN_PLAYERS}+ HUNTERS TO START. PLAYING SOLO? SEND A ROOM'S INVITE LINK TO A FRIEND — YOU BOTH LAND IN THE SAME ARENA.</div>
          {net?.rooms.map((r) => (
            <div key={r.room} className="row spread">
              <span className="note">{r.room} · {r.players}/{r.capacity} · ENTRY {formatAsset(BigInt(r.entryBaseUnits))}</span>
              <div className="row">
                <button className="btn small ghost" onClick={() => copyInvite(r.room)}>
                  {copied === r.room ? "LINK COPIED ✓" : "⧉ INVITE"}
                </button>
                <button className="btn small green" onClick={() => c?.joinRoom(r.room)}>JOIN</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {phase === "joining" && (
        <div className="grid-2">
          {/* LEFT — roster, ready-up, stake */}
          <div className="panel stack">
            <div className="row spread">
              <span style={{ fontSize: 12, color: "var(--gold)" }}>WAITING ROOM · {net?.room ?? "ROOM"}</span>
              <span className="tag hot">{net?.lobbyPlayers?.length ?? 1} HERE</span>
            </div>

            <div className="stack" style={{ gap: 6 }}>
              {net?.lobbyPlayers.map((p) => (
                <div key={p.id} className="row spread">
                  <span className="note">
                    <span style={{ color: p.joined ? "var(--green)" : p.ready ? "#ffcf6e" : "#555568" }}>●</span>{" "}
                    {p.alias.toUpperCase()}{p.id === selfId ? " (YOU)" : ""}
                  </span>
                  <span className="note" style={{ fontSize: 9 }}>{p.joined ? "STAKED ✓" : p.ready ? "READY" : "NOT READY"}</span>
                </div>
              ))}
            </div>

            {!selfStaked && (
              <>
                <button className={`btn ${selfReady ? "green" : ""}`} onClick={() => c?.setReady(!selfReady)}>
                  {selfReady ? "✓ READY — TAP TO STAND DOWN" : "I'M READY TO PLAY"}
                </button>
                {stakingUnlocked && selfReady ? (
                  <>
                    <div className="note" style={{ color: "var(--green)" }}>
                      {readyCount} HUNTERS READY — LOCK IN YOUR STAKE TO PLAY. NOTHING MOVED UNTIL YOU PAY.
                    </div>
                    <button className="btn" disabled={joinBusy} onClick={() => void payEntry()}>
                      {joinBusy
                        ? (tx.phase === "signing" ? `APPROVE IN WALLET — STAKING ${formatAsset(ENTRY_BASE_UNITS)}…`
                          : tx.phase === "confirming" ? "CONFIRMING ON-CHAIN…" : (tx.phase.toUpperCase() + "…"))
                        : `PAY ENTRY · ${formatAsset(ENTRY_BASE_UNITS)}`}
                    </button>
                    {tx.phase === "failed" && <div className="err">{(tx.error ?? "TRANSACTION FAILED").toUpperCase().slice(0, 120)}</div>}
                  </>
                ) : (
                  <>
                    <div className="note">
                      {needPlayers > 0
                        ? `A MATCH NEEDS ${MIN_PLAYERS}–${MAX_PLAYERS} HUNTERS — ${here} HERE. ${selfReady ? "YOU'RE READY. " : "TAP READY ABOVE, THEN "}INVITE ANOTHER HUNTER TO JOIN:`
                        : notReadyHere > 0
                          ? `${readyCount}/${here} READY — WAITING FOR ${notReadyHere} MORE HERE TO READY UP. STAKING UNLOCKS AT ${MIN_PLAYERS}.`
                          : "READY UP ABOVE TO UNLOCK STAKING."}
                    </div>
                    {net?.room && needPlayers > 0 && (
                      <button className="btn small" onClick={() => copyInvite(net.room!)}>
                        {copied === net.room ? "INVITE COPIED ✓" : `⧉ INVITE A FRIEND · ${net.room}`}
                      </button>
                    )}
                  </>
                )}
                <button className="btn small ghost" onClick={() => setPracticeWait((v) => !v)}>
                  {practiceWait ? "✕ STOP PRACTICE" : "🕹 PRACTICE WHILE YOU WAIT"}
                </button>
              </>
            )}
            {selfStaked && (
              <div className="stack" style={{ gap: 6 }}>
                <div className="note" style={{ color: "var(--green)" }}>
                  STAKED ✓ — {paidCount >= MIN_PLAYERS
                    ? "MATCH STARTING…"
                    : `WAITING FOR ${MIN_PLAYERS - paidCount} MORE HUNTER TO STAKE.`}
                </div>
                {paidCount < MIN_PLAYERS && net?.room && (
                  <button className="btn small" onClick={() => copyInvite(net.room!)}>
                    {copied === net.room ? "INVITE COPIED ✓" : `⧉ INVITE A FRIEND · ${net.room}`}
                  </button>
                )}
                {paidCount < MIN_PLAYERS && (
                  <div className="note" style={{ fontSize: 9 }}>NO SECOND PLAYER? YOUR STAKE IS SAFE — RECLAIM ON-CHAIN AFTER THE DEADLINE.</div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT — payout preview + room chat */}
          <div className="stack">
            <div className="panel accent stack">
              <span style={{ fontSize: 12, color: "var(--orange)" }}>STAKE {formatAsset(ENTRY_BASE_UNITS)} PER HUNTER · {MIN_PLAYERS}–{MAX_PLAYERS} PLAYERS</span>
              <div className="note">GRAB LOOT, RUN IT TO THE BANK — MOST BANKED IN {MATCH_SECONDS}s WINS. 0% FEE.</div>
              <div className="note">
                <b>2–3 HUNTERS:</b> WINNER TAKES THE WHOLE POT.<br />
                <b>4–8 HUNTERS:</b> TOP 3 SPLIT <b>70 / 20 / 10</b>.
              </div>
              <div className="note" style={{ color: "var(--gold)", fontSize: 11 }}>
                IF {projected} HUNTERS PLAY → POT {formatAsset(projPot)} · WINNER TAKES {formatAsset(projWinner)}{projected >= 4 ? " (1ST OF 3)" : ""}.
              </div>
              <div className="note" style={{ fontSize: 9 }}>NEVER FILLS OR SETTLES? RECLAIM YOUR STAKE ON-CHAIN. TESTNET · NO REAL VALUE.</div>
            </div>

            <div className="panel stack">
              <span style={{ fontSize: 11, color: "var(--gold)" }}>ROOM CHAT</span>
              <div style={{ maxHeight: 140, overflowY: "auto" }} className="stack">
                {(net?.chat ?? []).slice(-14).map((m, i) => (
                  <div key={i} className="note" style={{ fontSize: 10 }}>
                    <b style={{ color: m.from === selfId ? "var(--green)" : "var(--orange)" }}>{m.alias.toUpperCase()}:</b> {m.text}
                  </div>
                ))}
                {(net?.chat?.length ?? 0) === 0 && <div className="note" style={{ fontSize: 9 }}>SAY HI WHILE YOU WAIT…</div>}
              </div>
              <form className="row" onSubmit={(e) => { e.preventDefault(); const t = chatInput.trim(); if (t) { c?.sendChat(t); setChatInput(""); } }}>
                <input className="pix" style={{ flex: 1 }} maxLength={160} value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)} placeholder="MESSAGE…" />
                <button className="btn small" type="submit">SEND</button>
              </form>
            </div>
          </div>
        </div>
      )}

      {phase === "joining" && practiceWait && !selfStaked && (
        <div className="panel stack">
          <div className="row spread">
            <span style={{ fontSize: 11, color: "var(--gold)" }}>PRACTICE — VS BOTS, NOTHING STAKED (THE MATCH STARTS AUTOMATICALLY WHEN IT'S READY)</span>
          </div>
          <Practice alias={props.alias} onExit={() => setPracticeWait(false)} />
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
