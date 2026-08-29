/**
 * Canvas 2D arena renderer — pixel-law flat colors, no AA on sprites.
 * Draws from a view model the net client / practice sim maintains.
 */

import { TILE_PX, TILES_X, TILES_Y } from "../shared/constants";
import { isBank, MAP_ROWS } from "../shared/map";
import type { LootKind } from "../shared/types";

export type ViewPlayer = {
  id: string; alias: string; x: number; y: number;
  carrying: bigint; banked: bigint; immunity: number; connected: boolean;
  isSelf: boolean; colorIdx: number;
};
export type ViewLoot = { id: number; kind: LootKind; x: number; y: number };

export type View = {
  players: ViewPlayer[];
  loot: ViewLoot[];
  timeLeft: number;
  phase: string;
};

export const PLAYER_COLORS = ["#fcc76e", "#2962ff", "#ff4ec7", "#00de76", "#ff5a00", "#8be9fd", "#bd93f9", "#f1fa8c"];

const LOOT_STYLE: Record<LootKind, { size: number; color: string }> = {
  small: { size: 10, color: "#fcc76e" },
  medium: { size: 14, color: "#ffb020" },
  large: { size: 22, color: "#ff5a00" },
};

export const CANVAS_W = TILES_X * TILE_PX;
export const CANVAS_H = TILES_Y * TILE_PX;

export function drawArena(ctx: CanvasRenderingContext2D, view: View, nowMs: number): void {
  ctx.imageSmoothingEnabled = false;
  // Floor + walls + bank
  for (let ty = 0; ty < TILES_Y; ty++) {
    for (let tx = 0; tx < TILES_X; tx++) {
      const ch = MAP_ROWS[ty]![tx]!;
      if (ch === "#") {
        ctx.fillStyle = "#1b1b33";
        ctx.fillRect(tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX);
        ctx.fillStyle = "#26264a";
        ctx.fillRect(tx * TILE_PX, ty * TILE_PX, TILE_PX, 4);
      } else {
        ctx.fillStyle = (tx + ty) % 2 === 0 ? "#05051a" : "#070720";
        ctx.fillRect(tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX);
        if (isBank(tx, ty)) {
          ctx.fillStyle = "#00351f";
          ctx.fillRect(tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX);
          ctx.strokeStyle = "#00de76";
          ctx.lineWidth = 2;
          ctx.strokeRect(tx * TILE_PX + 2, ty * TILE_PX + 2, TILE_PX - 4, TILE_PX - 4);
        }
      }
    }
  }
  // BANK label
  ctx.fillStyle = "#00de76";
  ctx.font = "8px 'Press Start 2P', monospace";
  ctx.textAlign = "center";
  ctx.fillText("BANK", 12 * TILE_PX, 13.5 * TILE_PX - 20);

  // Loot (pulse the large cache)
  for (const l of view.loot) {
    const st = LOOT_STYLE[l.kind];
    const pulse = l.kind === "large" ? 1 + 0.15 * Math.sin(nowMs / 120) : 1;
    const s = st.size * pulse;
    const px = l.x * TILE_PX, py = l.y * TILE_PX;
    ctx.fillStyle = "#000";
    ctx.fillRect(px - s / 2 - 2, py - s / 2 - 2, s + 4, s + 4);
    ctx.fillStyle = st.color;
    ctx.fillRect(px - s / 2, py - s / 2, s, s);
    ctx.fillStyle = "#14100a";
    ctx.font = "7px 'Press Start 2P', monospace";
    ctx.fillText("₿", px, py + 3);
  }

  // Players
  for (const p of view.players) {
    const blink = p.immunity > 0 && Math.floor(nowMs / 120) % 2 === 0;
    if (blink) continue;
    const px = p.x * TILE_PX, py = p.y * TILE_PX;
    const size = 20;
    ctx.fillStyle = "#000";
    ctx.fillRect(px - size / 2 - 2, py - size / 2 - 2, size + 4, size + 4);
    ctx.fillStyle = PLAYER_COLORS[p.colorIdx % PLAYER_COLORS.length]!;
    ctx.fillRect(px - size / 2, py - size / 2, size, size);
    // eyes — cheap personality, pixel-law compliant
    ctx.fillStyle = "#000012";
    ctx.fillRect(px - 5, py - 4, 4, 4);
    ctx.fillRect(px + 1, py - 4, 4, 4);
    if (p.isSelf) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.strokeRect(px - size / 2 - 3, py - size / 2 - 3, size + 6, size + 6);
    }
    ctx.font = "7px 'Press Start 2P', monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = p.connected ? "#ffffff" : "#555568";
    ctx.fillText(p.alias.slice(0, 10).toUpperCase(), px, py - size / 2 - 8);
    if (p.carrying > 0n) {
      ctx.fillStyle = "#ff4ec7";
      ctx.fillText(`+${p.carrying}`, px, py + size / 2 + 12);
    }
  }
}
