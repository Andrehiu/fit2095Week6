// Dijkstra flow field: one search from the player gives every enemy a path around the shelves.
// Generic over grid size so it can be unit-tested with tiny hand-made grids.

const NEIGH = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const topK = k[0], topV = v[0];
    const lastK = k.pop(), lastV = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mk = lastK;
        if (l < n && k[l] < mk) { m = l; mk = k[l]; }
        if (r < n && k[r] < mk) { m = r; }
        if (m === i) break;
        k[i] = k[m]; v[i] = v[m]; i = m;
      }
      k[i] = lastK; v[i] = lastV;
    }
    return [topK, topV];
  }
}

function canStep(solid, cols, rows, cx, cy, dx, dy) {
  const nx = cx + dx, ny = cy + dy;
  if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return false;
  if (solid[ny * cols + nx]) return false;
  // No diagonal corner-cutting through shelf corners.
  if (dx && dy && (solid[cy * cols + nx] || solid[ny * cols + cx])) return false;
  return true;
}

/** Returns {dist, dirX, dirY} per cell; dir points one step closer to the target. */
export function computeFlowField(solid, cols, rows, tc, tr) {
  const n = cols * rows;
  const dist = new Float32Array(n).fill(Infinity);
  const dirX = new Float32Array(n), dirY = new Float32Array(n);
  const start = tr * cols + tc;
  dist[start] = 0;
  const heap = new MinHeap();
  heap.push(0, start);
  while (heap.size) {
    const [d, i] = heap.pop();
    if (d > dist[i]) continue;
    const cx = i % cols, cy = (i / cols) | 0;
    for (const [dx, dy, c] of NEIGH) {
      if (!canStep(solid, cols, rows, cx, cy, dx, dy)) continue;
      const ni = (cy + dy) * cols + cx + dx;
      const nd = d + c;
      // Push the float32-rounded value: comparing a float64 key against the float32 store
      // would otherwise make genuine entries look stale and leave cells unreachable.
      if (nd < dist[ni]) { dist[ni] = nd; heap.push(dist[ni], ni); }
    }
  }
  for (let i = 0; i < n; i++) {
    if (i === start || solid[i] || !isFinite(dist[i])) continue;
    const cx = i % cols, cy = (i / cols) | 0;
    let best = dist[i], bx = 0, by = 0;
    for (const [dx, dy] of NEIGH) {
      if (!canStep(solid, cols, rows, cx, cy, dx, dy)) continue;
      const nd = dist[(cy + dy) * cols + cx + dx];
      if (nd < best) { best = nd; bx = dx; by = dy; }
    }
    const len = Math.hypot(bx, by) || 1;
    dirX[i] = bx / len; dirY[i] = by / len;
  }
  return { dist, dirX, dirY, cols, rows };
}

/** Grid ray-march: is the straight segment free of solid cells? */
export function lineOfSight(solid, cols, rows, cell, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.ceil(Math.hypot(dx, dy) / (cell / 3));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cx = Math.floor((x0 + dx * t) / cell), cy = Math.floor((y0 + dy * t) / cell);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
    if (solid[cy * cols + cx]) return false;
  }
  return true;
}
