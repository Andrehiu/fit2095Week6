// Procedural, mirrored library layouts on a grid. Pure module (no DOM) so it is unit-testable.
import { Rng, hashString, clamp } from './util.js';

export const CELL = 30;
// Grid size is switchable between landscape (32x18 = 960x540) and portrait (18x32 = 540x960)
// for phones. These are live ES-module bindings, so importers always see the current layout.
export let COLS = 32;
export let ROWS = 18;
export let W = COLS * CELL;
export let H = ROWS * CELL;
/** Cells kept clear around the player's spawn point (inclusive bounds). */
export let SAFE = { x0: 12, y0: 6, x1: 19, y1: 11 };
export let PORTRAIT = false;

/** Switch between the landscape and portrait arena. Call only between runs. */
export function setOrientation(portrait) {
  PORTRAIT = !!portrait;
  COLS = portrait ? 18 : 32;
  ROWS = portrait ? 32 : 18;
  W = COLS * CELL; H = ROWS * CELL;
  const hw = portrait ? 3 : 4, hh = portrait ? 4 : 3; // half-size of the clear zone
  SAFE = { x0: (COLS >> 1) - hw, y0: (ROWS >> 1) - hh, x1: (COLS >> 1) + hw - 1, y1: (ROWS >> 1) + hh - 1 };
}

export const idx = (cx, cy) => cy * COLS + cx;

export function cellOf(x, y) {
  return [clamp(Math.floor(x / CELL), 0, COLS - 1), clamp(Math.floor(y / CELL), 0, ROWS - 1)];
}

/** True if pixel position is inside a shelf or outside the arena. */
export function isSolidPx(solid, x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return true;
  return solid[idx(Math.floor(x / CELL), Math.floor(y / CELL))] === 1;
}

/** Every free cell must be reachable from the centre (4-neighbour flood fill). */
export function isConnected(solid) {
  const start = idx(COLS >> 1, ROWS >> 1);
  if (solid[start]) return false;
  const seen = new Uint8Array(COLS * ROWS);
  const stack = [start];
  seen[start] = 1;
  let reached = 0;
  while (stack.length) {
    const i = stack.pop();
    reached++;
    const cx = i % COLS, cy = (i / COLS) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const ni = idx(nx, ny);
      if (!seen[ni] && !solid[ni]) { seen[ni] = 1; stack.push(ni); }
    }
  }
  let free = 0;
  for (let i = 0; i < solid.length; i++) if (!solid[i]) free++;
  return reached === free;
}

function overlapsSafe(x, y, w, h) {
  return x <= SAFE.x1 && x + w - 1 >= SAFE.x0 && y <= SAFE.y1 && y + h - 1 >= SAFE.y0;
}

/**
 * Generate a symmetric library floor: shelves are placed in the left half and mirrored.
 * Deterministic for a given (seed, wave).
 */
export function generateArena(seed, wave) {
  const rng = new Rng(hashString(`arena:${seed}:${wave}`));
  const perHalf = Math.min(2 + Math.floor((wave + 1) / 2), 6);
  for (let attempt = 0; attempt < 40; attempt++) {
    const solid = new Uint8Array(COLS * ROWS);
    const shelves = [];
    let tries = 0;
    while (shelves.length < perHalf * 2 && tries++ < 300) {
      const horiz = rng.chance(0.55);
      const w = horiz ? rng.int(3, 5) : 1;
      const h = horiz ? 1 : rng.int(2, 4);
      const x = rng.int(2, (COLS >> 1) - 1 - w);
      const y = rng.int(2, ROWS - 2 - h);
      if (overlapsSafe(x, y, w, h)) continue;
      // Keep a one-cell corridor around every shelf.
      let blocked = false;
      for (let yy = y - 1; yy <= y + h && !blocked; yy++)
        for (let xx = x - 1; xx <= x + w; xx++)
          if (solid[idx(xx, yy)]) { blocked = true; break; }
      if (blocked) continue;
      const mx = COLS - x - w; // mirrored x
      for (const sx of [x, mx]) {
        for (let yy = y; yy < y + h; yy++) for (let xx = sx; xx < sx + w; xx++) solid[idx(xx, yy)] = 1;
        shelves.push({ x: sx, y, w, h });
      }
    }
    if (isConnected(solid)) {
      const rects = shelves.map((s) => ({ x: s.x * CELL, y: s.y * CELL, w: s.w * CELL, h: s.h * CELL }));
      return { seed, wave, shelves, rects, solid };
    }
  }
  return { seed, wave, shelves: [], rects: [], solid: new Uint8Array(COLS * ROWS) };
}

/** Free cells on the outer ring, used as enemy entry points. */
export function edgeCells(solid) {
  const out = [];
  for (let x = 0; x < COLS; x++) for (const y of [0, ROWS - 1]) if (!solid[idx(x, y)]) out.push([x, y]);
  for (let y = 1; y < ROWS - 1; y++) for (const x of [0, COLS - 1]) if (!solid[idx(x, y)]) out.push([x, y]);
  return out;
}
