/**
 * Core types. GameScore and AssetAmount are both bigint but BRANDED —
 * they never mix (docs/ASSET_MODEL.md).
 */

export type GameScore = bigint & { readonly __brand?: "GameScore" };
export type AssetAmount = bigint & { readonly __brand?: "AssetAmount" };

export type LootKind = "small" | "medium" | "large";

export type Loot = {
  id: number;
  kind: LootKind;
  x: number; // tiles
  y: number;
  value: GameScore;
};

export type PlayerState = {
  id: string; // pubkey hex in live mode; local id in practice
  alias: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  carrying: GameScore;
  banked: GameScore;
  /** seconds of scatter immunity remaining */
  immunity: number;
  lastBankAt: number; // match-seconds timestamp of latest bank (tiebreak)
  connected: boolean;
  /** held-direction input bitmask: 1=up 2=down 4=left 8=right */
  input: number;
  lastInputSeq: number;
};

export type MatchPhase = "lobby" | "countdown" | "live" | "ended";

export type SimState = {
  phase: MatchPhase;
  /** seconds remaining in the current phase */
  timeLeft: number;
  players: Map<string, PlayerState>;
  loot: Map<number, Loot>;
  nextLootId: number;
  largeSpawned: boolean;
  matchSeconds: number; // elapsed in live phase
};

export type RankedPlayer = {
  id: string;
  alias: string;
  banked: GameScore;
  rank: number;
};

export type CanonicalResult = {
  game: "satoshi-scramble";
  ruleset: string;
  matchId: bigint;
  roomId: string;
  entry: AssetAmount;
  players: { id: string; banked: GameScore }[]; // join order
  rankings: number[]; // indices into players, best first
  startTs: number;
  endTs: number;
};
