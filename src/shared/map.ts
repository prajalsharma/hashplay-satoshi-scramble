/**
 * The SCRAMBLE_V1 arena: 24×16 tiles. '#' wall · 'B' bank zone · '.' floor.
 * Two chokepoints, one safe corridor, bank bottom-center — median loot→bank
 * run 3-5s at MAX_SPEED (docs/DESIGN.md).
 */

import { TILES_X, TILES_Y } from "./constants";

// prettier-ignore
export const MAP_ROWS: string[] = [
  "########################",
  "#......................#",
  "#..##......##......##..#",
  "#..##......##......##..#",
  "#......................#",
  "#......................#",
  "#....####....####......#",
  "#......................#",
  "#......................#",
  "#..##......##......##..#",
  "#..##......##......##..#",
  "#......................#",
  "#......................#",
  "#..........BB..........#",
  "#..........BB..........#",
  "########################",
];

if (MAP_ROWS.length !== TILES_Y || MAP_ROWS.some((r) => r.length !== TILES_X)) {
  throw new Error("MAP_ROWS does not match arena dimensions");
}

export const isWall = (tx: number, ty: number): boolean =>
  tx < 0 || ty < 0 || tx >= TILES_X || ty >= TILES_Y || MAP_ROWS[ty]![tx] === "#";

export const isBank = (tx: number, ty: number): boolean =>
  MAP_ROWS[ty]?.[tx] === "B";

/** Player spawn pads (tile centers), shuffled per match. */
export const SPAWN_PADS: [number, number][] = [
  [1.5, 1.5], [22.5, 1.5], [1.5, 14 - 0.5], [22.5, 13.5],
  [11.5, 1.5], [1.5, 7.5], [22.5, 7.5], [12.5, 11.5],
];

/** Fixed loot spawn points; server shuffles with its seed. */
export const LOOT_POINTS: [number, number][] = [
  [5.5, 2.5], [18.5, 2.5], [11.5, 4.5], [3.5, 5.5], [20.5, 5.5],
  [8.5, 7.5], [15.5, 7.5], [5.5, 9.5], [18.5, 11.5], [11.5, 8.5],
  [3.5, 11.5], [20.5, 8.5], [8.5, 12.5], [15.5, 12.5],
];

/** LARGE cache spawns dead center at T-20s. */
export const LARGE_CACHE_POINT: [number, number] = [11.5, 5.5];
