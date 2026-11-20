// Small, dependency-free helpers shared by the game and its unit tests.
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Wrap an angle difference into (-PI, PI]. */
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/** FNV-1a string hash -> uint32. Used to derive deterministic seeds. */
export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (const ch of String(s)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: tiny, fast, good-enough seeded PRNG returning [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded RNG with convenience helpers. Same seed => same sequence. */
export class Rng {
  constructor(seed) { this.next = mulberry32(seed); }
  float(a = 0, b = 1) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.float(a, b + 1)); } // inclusive
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  /** Pick from [{weight}, ...] proportionally to weight. */
  weighted(items, key = 'weight') {
    const total = items.reduce((s, it) => s + it[key], 0);
    let r = this.next() * total;
    for (const it of items) { r -= it[key]; if (r < 0) return it; }
    return items[items.length - 1];
  }
}

/**
 * Push a circle out of an axis-aligned rectangle.
 * Returns the push normal {nx, ny} when they overlapped (and mutates obj.x/y), else null.
 */
export function pushCircleOutOfRect(obj, r, rect) {
  const cx = clamp(obj.x, rect.x, rect.x + rect.w);
  const cy = clamp(obj.y, rect.y, rect.y + rect.h);
  let dx = obj.x - cx, dy = obj.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 > r * r) return null;
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2);
    const nx = dx / d, ny = dy / d;
    obj.x = cx + nx * r; obj.y = cy + ny * r;
    return { nx, ny };
  }
  // Centre is inside the rect: push out along the axis of least penetration.
  const left = obj.x - rect.x, right = rect.x + rect.w - obj.x;
  const top = obj.y - rect.y, bottom = rect.y + rect.h - obj.y;
  const m = Math.min(left, right, top, bottom);
  if (m === left) { obj.x = rect.x - r; return { nx: -1, ny: 0 }; }
  if (m === right) { obj.x = rect.x + rect.w + r; return { nx: 1, ny: 0 }; }
  if (m === top) { obj.y = rect.y - r; return { nx: 0, ny: -1 }; }
  obj.y = rect.y + rect.h + r; return { nx: 0, ny: 1 };
}
