/** Keyboard → direction bitmask (WASD + arrows). */

import { DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP } from "../shared/sim";

const KEYMAP: Record<string, number> = {
  KeyW: DIR_UP, ArrowUp: DIR_UP,
  KeyS: DIR_DOWN, ArrowDown: DIR_DOWN,
  KeyA: DIR_LEFT, ArrowLeft: DIR_LEFT,
  KeyD: DIR_RIGHT, ArrowRight: DIR_RIGHT,
};

export function attachInput(onChange: (mask: number) => void): () => void {
  let mask = 0;
  const down = (e: KeyboardEvent) => {
    const bit = KEYMAP[e.code];
    if (!bit) return;
    e.preventDefault();
    const next = mask | bit;
    if (next !== mask) { mask = next; onChange(mask); }
  };
  const up = (e: KeyboardEvent) => {
    const bit = KEYMAP[e.code];
    if (!bit) return;
    const next = mask & ~bit;
    if (next !== mask) { mask = next; onChange(mask); }
  };
  const blur = () => { if (mask !== 0) { mask = 0; onChange(0); } };
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  window.addEventListener("blur", blur);
  return () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", blur);
  };
}
