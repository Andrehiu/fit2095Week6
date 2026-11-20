// Roguelite perk cards offered between waves. Pure data + a seeded roller.

export function baseStats() {
  return {
    maxHp: 5, speed: 210, fireRate: 4, damage: 1, projectiles: 1, spread: 0.2,
    bounces: 0, pierce: 0, homing: 0, critChance: 0.05, dashCd: 0.9,
    shhhCd: 8, shhhRadius: 140, orbiters: 0, iframes: 0.8, projSpeed: 520,
  };
}

export const UPGRADES = [
  { id: 'hardcover', icon: '📕', name: 'Hardcover Edition', desc: '+1 damage per book', max: 5, weight: 10, apply: (s) => { s.damage += 1; } },
  { id: 'speedreader', icon: '⚡', name: 'Speed Reader', desc: '+25% throw rate', max: 5, weight: 10, apply: (s) => { s.fireRate *= 1.25; } },
  { id: 'trilogy', icon: '📚', name: 'Trilogy Box Set', desc: '+2 books per throw', max: 3, weight: 6, apply: (s) => { s.projectiles += 2; s.spread = Math.max(0.12, s.spread * 0.85); } },
  { id: 'bookmark', icon: '🔖', name: 'Bouncy Bookmark', desc: 'Books ricochet off shelves & walls (+1 bounce)', max: 3, weight: 7, apply: (s) => { s.bounces += 1; } },
  { id: 'plottwist', icon: '🌀', name: 'Plot Twist', desc: 'Books pierce through +1 enemy', max: 3, weight: 7, apply: (s) => { s.pierce += 1; } },
  { id: 'dewey', icon: '🧭', name: 'Dewey Decimal Guidance', desc: 'Books home in on nearby enemies', max: 3, weight: 6, apply: (s) => { s.homing += 2.4; } },
  { id: 'coffee', icon: '☕', name: 'Double Espresso', desc: '+12% move speed, −15% dash cooldown', max: 4, weight: 8, apply: (s) => { s.speed *= 1.12; s.dashCd *= 0.85; } },
  { id: 'extendedloan', icon: '❤️', name: 'Extended Loan', desc: '+1 max heart and fully heal', max: 4, weight: 7, apply: (s, p) => { s.maxHp += 1; if (p) p.hp = s.maxHp; } },
  { id: 'quietplease', icon: '🤫', name: 'Quiet Please', desc: 'SHHH! recharges 25% faster and reaches 20% further', max: 3, weight: 6, apply: (s) => { s.shhhCd *= 0.75; s.shhhRadius *= 1.2; } },
  { id: 'footnotes', icon: '✳️', name: 'Footnotes', desc: '+12% chance to crit for 2.5× damage', max: 4, weight: 7, apply: (s) => { s.critChance += 0.12; } },
  { id: 'audiobook', icon: '🎧', name: 'Audiobook Orbit', desc: '+1 book orbits you, smacking enemies', max: 4, weight: 5, apply: (s) => { s.orbiters += 1; } },
  { id: 'graceperiod', icon: '🕊️', name: 'Grace Period', desc: 'Heal 1 heart; +0.3s invulnerability after a hit', max: 3, weight: 6, apply: (s, p) => { s.iframes += 0.3; if (p) p.hp = Math.min(s.maxHp, p.hp + 1); } },
];

/** Draw `n` distinct, not-yet-maxed perks, weighted by rarity. */
export function rollUpgrades(rng, owned = {}, n = 3) {
  const pool = UPGRADES.filter((u) => (owned[u.id] || 0) < u.max);
  const out = [];
  while (out.length < n && pool.length) {
    const pick = rng.weighted(pool);
    out.push(pick);
    pool.splice(pool.indexOf(pick), 1);
  }
  return out;
}
