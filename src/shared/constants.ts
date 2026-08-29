/**
 * SCRAMBLE_V1 — the authoritative rule numbers (docs/DESIGN.md).
 * Changing anything here is a ruleset change: bump RULESET_VERSION.
 */

export const RULESET_VERSION = "SCRAMBLE_V1";

// Arena
export const TILES_X = 24;
export const TILES_Y = 16;
export const TILE_PX = 32;

// Match
export const MATCH_SECONDS = 90;
export const COUNTDOWN_SECONDS = 3;
export const LOBBY_FILL_SECONDS = 30;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

// Movement (units: tiles, seconds)
export const MAX_SPEED = 4.5;
export const ACCEL = 25;
export const FRICTION = 18;
export const PLAYER_RADIUS = 0.35;

// Server
export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;
export const MAX_INPUTS_PER_SEC = 30;

// Loot (GameScore — NEVER money)
export const LOOT_SMALL = 10n;
export const LOOT_MEDIUM = 25n;
export const LOOT_LARGE = 100n;
export const SMALL_RADIUS = 0.3;
export const MEDIUM_RADIUS = 0.35;
export const LARGE_RADIUS = 0.5;
export const PICKUP_TOLERANCE = 0.05;
export const SMALL_TARGET = 6; // respawn to keep at least this many
export const MEDIUM_TARGET = 3;
export const SMALL_INITIAL = 8;
export const MEDIUM_INITIAL = 4;
export const LARGE_CACHE_AT_SECONDS_LEFT = 20;

// Scatter rule
export const SCATTER_FRACTION_NUM = 1n; // drop carrying * 1/2
export const SCATTER_FRACTION_DEN = 2n;
export const IMMUNITY_SECONDS = 1.5;

// Economics (AssetAmount — aBTC base units, 8 decimals) — CONFIRMED, frozen.
export const ENTRY_BASE_UNITS = 10_000n; // 0.0001 aBTC
export const PAYOUT_SPLIT_4PLUS = [70n, 20n, 10n] as const; // percent, ranks 1-3
export const ASSET_DECIMALS = 8;
export const ASSET_SYMBOL = "aBTC";

// On-chain deadlines (seconds)
export const JOIN_TIMEOUT_SECS = 180n;
export const SETTLE_TIMEOUT_SECS = 900n;
