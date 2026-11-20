// Budget-based wave composer. Pure + seeded => every run with the same seed plays the same waves.

export const ENEMY_TYPES = {
  bunny: { cost: 1, unlock: 1, weight: 4, maxGroup: 5 },
  notice: { cost: 1.5, unlock: 2, weight: 3, maxGroup: 4 },
  patron: { cost: 3, unlock: 3, weight: 2, maxGroup: 2 },
  worm: { cost: 6, unlock: 4, weight: 1.5, maxGroup: 1 },
  golem: { cost: 5, unlock: 6, weight: 1.2, maxGroup: 2 },
};

export const isBossWave = (w) => w > 0 && w % 5 === 0;

export function waveBudget(w) {
  const b = 5 + w * 3.5 + Math.pow(w, 1.35) * 0.5;
  return isBossWave(w) ? b * 0.35 : b;
}

/** Returns {wave, boss, spawns:[{type, t}]} sorted by spawn time t (seconds). */
export function composeWave(wave, rng) {
  let budget = waveBudget(wave);
  const spawns = [];
  const gap = Math.max(0.55, 2.3 - wave * 0.09);
  const unlocked = Object.entries(ENEMY_TYPES)
    .filter(([, d]) => d.unlock <= wave)
    .map(([type, d]) => ({ type, ...d }));
  let t = 0.8;
  for (let guard = 0; guard < 500; guard++) {
    const options = unlocked.filter((d) => d.cost <= budget + 1e-9);
    if (!options.length) break;
    const def = rng.weighted(options);
    const maxCount = Math.max(1, Math.min(def.maxGroup, Math.floor(budget / def.cost)));
    const count = rng.int(1, maxCount);
    for (let i = 0; i < count; i++) {
      spawns.push({ type: def.type, t: +(t + i * 0.2).toFixed(3) });
      budget -= def.cost;
    }
    t += gap * (0.7 + rng.next() * 0.6);
  }
  if (isBossWave(wave)) spawns.push({ type: 'boss', t: 1.2 });
  spawns.sort((a, b) => a.t - b.t);
  return { wave, boss: isBossWave(wave), spawns };
}
