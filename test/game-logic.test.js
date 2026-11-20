// Unit tests for the game's pure, DOM-free modules (ES modules loaded via dynamic import).
const test = require('node:test');
const assert = require('node:assert/strict');

const load = (m) => import(`../public/game/${m}.js`);

test('Rng is deterministic per seed and int() is inclusive', async () => {
  const { Rng } = await load('util');
  const a = new Rng(42), b = new Rng(42), c = new Rng(43);
  const sa = Array.from({ length: 20 }, () => a.next());
  const sb = Array.from({ length: 20 }, () => b.next());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, Array.from({ length: 20 }, () => c.next()));
  const r = new Rng(1), seen = new Set();
  for (let i = 0; i < 2000; i++) { const v = r.int(1, 3); assert.ok(v >= 1 && v <= 3); seen.add(v); }
  assert.deepEqual([...seen].sort(), [1, 2, 3]);
});

test('angleDiff wraps into (-PI, PI]', async () => {
  const { angleDiff } = await load('util');
  assert.ok(Math.abs(angleDiff(0.1, -0.1) + 0.2) < 1e-9);
  assert.ok(Math.abs(angleDiff(Math.PI - 0.1, -Math.PI + 0.1) - 0.2) < 1e-9);
});

test('pushCircleOutOfRect resolves overlap, including centre-inside case', async () => {
  const { pushCircleOutOfRect } = await load('util');
  const rect = { x: 0, y: 0, w: 30, h: 30 };
  const o = { x: 35, y: 15 };
  assert.deepEqual(pushCircleOutOfRect(o, 10, rect), { nx: 1, ny: 0 });
  assert.equal(o.x, 40);
  const inside = { x: 2, y: 15 };
  assert.deepEqual(pushCircleOutOfRect(inside, 5, rect), { nx: -1, ny: 0 });
  assert.equal(inside.x, -5);
  assert.equal(pushCircleOutOfRect({ x: 100, y: 100 }, 5, rect), null);
});

test('arenas are deterministic, symmetric, connected and keep the spawn zone clear', async () => {
  const { generateArena, isConnected, COLS, ROWS, SAFE, idx } = await load('arena');
  for (let wave = 1; wave <= 30; wave++) {
    for (const seed of [1, 7, 123456, 987654321]) {
      const a = generateArena(seed, wave);
      assert.deepEqual(a.shelves, generateArena(seed, wave).shelves, 'deterministic');
      assert.ok(isConnected(a.solid), `connected seed=${seed} wave=${wave}`);
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
        assert.equal(a.solid[idx(x, y)], a.solid[idx(COLS - 1 - x, y)], 'mirror symmetric');
        if (x >= SAFE.x0 && x <= SAFE.x1 && y >= SAFE.y0 && y <= SAFE.y1) assert.equal(a.solid[idx(x, y)], 0, 'safe zone clear');
        if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1) assert.equal(a.solid[idx(x, y)], 0, 'edges clear for spawns');
      }
    }
  }
  assert.ok(generateArena(5, 10).shelves.length > generateArena(5, 1).shelves.length, 'later waves are busier');
});

test('flow field routes around a wall and never steps into solids', async () => {
  const { computeFlowField, lineOfSight } = await load('flowfield');
  // 7x5 grid with a vertical wall at x=3 except a gap at y=4
  const cols = 7, rows = 5, solid = new Uint8Array(cols * rows);
  for (let y = 0; y < 4; y++) solid[y * cols + 3] = 1;
  const f = computeFlowField(solid, cols, rows, 6, 0);
  assert.equal(f.dist[0 * cols + 6], 0);
  // Walk from (0,0) following the field: must reach target via the gap
  let x = 0, y = 0, steps = 0;
  while (!(x === 6 && y === 0) && steps++ < 50) {
    const i = y * cols + x;
    x += Math.sign(f.dirX[i]);
    y += Math.sign(f.dirY[i]);
    assert.equal(solid[y * cols + x], 0, `stepped into wall at ${x},${y}`);
  }
  assert.ok(x === 6 && y === 0, 'reached target');
  assert.ok(f.dist[0] > 6, 'path is longer than the straight line');
  assert.equal(lineOfSight(solid, cols, rows, 10, 5, 5, 65, 5), false);
  assert.equal(lineOfSight(solid, cols, rows, 10, 5, 45, 65, 45), true);
});

test('waves respect budget, unlock order and boss cadence', async () => {
  const { composeWave, waveBudget, ENEMY_TYPES, isBossWave } = await load('waves');
  const { Rng } = await load('util');
  for (let w = 1; w <= 25; w++) {
    const wave = composeWave(w, new Rng(w * 31));
    const cost = wave.spawns.filter((s) => s.type !== 'boss').reduce((s, x) => s + ENEMY_TYPES[x.type].cost, 0);
    assert.ok(cost <= waveBudget(w) + 1e-9, `budget wave ${w}`);
    assert.ok(cost >= waveBudget(w) - 1, `budget mostly spent wave ${w}`);
    for (const s of wave.spawns) if (s.type !== 'boss') assert.ok(ENEMY_TYPES[s.type].unlock <= w, `${s.type} locked at ${w}`);
    assert.equal(wave.spawns.some((s) => s.type === 'boss'), isBossWave(w));
    for (let i = 1; i < wave.spawns.length; i++) assert.ok(wave.spawns[i].t >= wave.spawns[i - 1].t, 'sorted');
  }
  assert.deepEqual(composeWave(8, new Rng(5)), composeWave(8, new Rng(5)));
});

test('rollUpgrades returns distinct, non-maxed perks that mutate stats', async () => {
  const { rollUpgrades, UPGRADES, baseStats } = await load('upgrades');
  const { Rng } = await load('util');
  const rng = new Rng(9);
  const picks = rollUpgrades(rng, {}, 3);
  assert.equal(new Set(picks.map((p) => p.id)).size, 3);
  const owned = Object.fromEntries(UPGRADES.map((u) => [u.id, u.max]));
  delete owned.hardcover;
  assert.deepEqual(rollUpgrades(rng, owned, 3).map((u) => u.id), ['hardcover']);
  const s = baseStats(), p = { hp: 1 };
  UPGRADES.find((u) => u.id === 'extendedloan').apply(s, p);
  assert.equal(s.maxHp, 6); assert.equal(p.hp, 6);
});

test('regression: flow field reaches every free cell on generated arenas', async () => {
  const { generateArena, COLS, ROWS } = await load('arena');
  const { computeFlowField } = await load('flowfield');
  for (let wave = 1; wave <= 12; wave++) {
    const a = generateArena(2024, wave);
    for (const [tx, ty] of [[16, 9], [0, 0], [31, 17], [5, 12]]) {
      const f = computeFlowField(a.solid, COLS, ROWS, tx, ty);
      for (let i = 0; i < a.solid.length; i++) if (!a.solid[i]) assert.ok(Number.isFinite(f.dist[i]), `cell ${i} unreachable (wave ${wave})`);
    }
  }
});
