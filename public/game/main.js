// OVERDUE! — Night Shift at the Meme Library
// Engine: fixed-timestep loop, flow-field AI, dynamic lighting, procedural audio, roguelite perks.
import { W, H, CELL, COLS, ROWS, SAFE, generateArena, isSolidPx, cellOf, edgeCells, idx } from './arena.js';
import { computeFlowField, lineOfSight } from './flowfield.js';
import { composeWave } from './waves.js';
import { baseStats, rollUpgrades } from './upgrades.js';
import { Rng, clamp, lerp, TAU, hashString, angleDiff, pushCircleOutOfRect } from './util.js';
import { SoundEngine } from './audio.js';

// ======================================================================
// Setup, settings, content
// ======================================================================
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
const $ = (s) => document.querySelector(s);
const DEBUG = new URLSearchParams(location.search).has('debug');

const loadJSON = (k) => { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; } };
const saveJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };
const SETTINGS_KEY = 'overdue.settings.v1';
const settings = Object.assign({ sfx: true, music: true, lights: true, motion: true, autofire: false }, loadJSON(SETTINGS_KEY));

const sound = new SoundEngine();
sound.sfxOn = settings.sfx; sound.musicOn = settings.music;

const FALLBACK_CONTENT = {
  source: 'offline',
  books: [
    { title: 'Much Wow: A Doge Memoir', author: 'Shiba Inu' },
    { title: 'One Does Not Simply Return a Book On Time', author: 'Boromir Gondorson' },
    { title: 'This Is Fine: Fire Safety for Libraries', author: 'Question Hound' },
    { title: 'Never Gonna Give You Up (the Late Fees)', author: 'R. Astley' },
  ],
  authors: [{ name: 'Grumpy Cat' }, { name: 'Bad Luck Brian' }, { name: 'Philosoraptor' }],
};
let content = FALLBACK_CONTENT;
fetch('/api/game/content')
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => { if (d && Array.isArray(d.books) && d.books.length) content = d; updateSourceBadge(); })
  .catch(updateSourceBadge);

function updateSourceBadge() {
  const el = $('#source');
  if (!el) return;
  const n = content.books.length;
  el.textContent = content.source === 'db'
    ? `📚 Ammo: ${n} real titles from your library database`
    : content.source === 'fallback'
      ? `📚 Ammo: ${n} titles from the built-in meme catalogue (add books to your library to use them!)`
      : '📚 Offline mode — built-in titles';
}
const pickBook = () => content.books[(Math.random() * content.books.length) | 0];
const pickAuthor = () => {
  const a = content.authors && content.authors.length ? content.authors[(Math.random() * content.authors.length) | 0] : null;
  return (a && a.name) || 'The Anonymous Author';
};
const short = (s, n = 28) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const bookColor = (title) => `hsl(${hashString(title) % 360} 65% 55%)`;

// ======================================================================
// Canvas sizing (logical 960x540, letterboxed, HiDPI aware)
// ======================================================================
let dpr = 1, viewScale = 1;
function resize() {
  const scale = Math.min(innerWidth / W, innerHeight / H);
  const cw = Math.floor(W * scale), ch = Math.floor(H * scale);
  stage.style.width = cw + 'px'; stage.style.height = ch + 'px';
  stage.style.setProperty('--ui-scale', String(Math.max(0.55, Math.min(1.25, scale))));
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  viewScale = cw / W;
}
addEventListener('resize', resize);
resize();

// ======================================================================
// Input: keyboard + mouse, touch (virtual stick), gamepad
// ======================================================================
const keys = new Set();
const actions = { dash: false, shhh: false };
const mouse = { x: W / 2, y: H / 2, down: false, seen: false };
const touch = { enabled: false, moveId: null, mx0: 0, my0: 0, mx: 0, my: 0, aimId: null, ax: 0, ay: 0 };
const pad = { connected: false, mx: 0, my: 0, ax: 0, ay: 0, fire: false, prev: [] };

function toLogical(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
}

addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  const k = e.code;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k) && game.state === 'playing') e.preventDefault();
  if (!keys.has(k)) onKeyPress(k);
  keys.add(k);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); mouse.down = false; if (game.state === 'playing') pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && game.state === 'playing') pause(); });

function onKeyPress(k) {
  sound.init();
  if (game.state === 'playing') {
    if (k === 'Space' || k === 'ShiftLeft' || k === 'ShiftRight') actions.dash = true;
    if (k === 'KeyE' || k === 'KeyQ') actions.shhh = true;
    if (k === 'KeyP' || k === 'Escape') pause();
  } else if (game.state === 'paused' && (k === 'KeyP' || k === 'Escape')) resume();
  else if (game.state === 'upgrade' && /^Digit[1-3]$/.test(k)) {
    const b = document.querySelectorAll('#cards .card')[+k.slice(5) - 1];
    if (b) b.click();
  } else if (game.state === 'title' && (k === 'Enter') && !document.activeElement?.matches('button')) startRun();
  if (k === 'KeyM') { const on = !(settings.sfx || settings.music); setSetting('sfx', on); setSetting('music', on); toast(on ? '🔊 Sound on' : '🔇 Muted'); }
  if (k === 'KeyF' && game.state === 'playing') { setSetting('autofire', !settings.autofire); toast(`Auto-fire ${settings.autofire ? 'ON' : 'OFF'}`); }
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  sound.init();
  const p = toLogical(e);
  if (e.pointerType === 'touch') {
    e.preventDefault();
    enableTouch();
    if (p.x < W * 0.45 && touch.moveId === null) { touch.moveId = e.pointerId; touch.mx0 = touch.mx = p.x; touch.my0 = touch.my = p.y; }
    else if (touch.aimId === null) { touch.aimId = e.pointerId; touch.ax = p.x; touch.ay = p.y; }
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  mouse.x = p.x; mouse.y = p.y; mouse.seen = true;
  if (e.button === 0) mouse.down = true;
  if (e.button === 2 && game.state === 'playing') actions.shhh = true;
});
canvas.addEventListener('pointermove', (e) => {
  const p = toLogical(e);
  if (e.pointerType === 'touch') {
    if (e.pointerId === touch.moveId) { touch.mx = p.x; touch.my = p.y; }
    if (e.pointerId === touch.aimId) { touch.ax = p.x; touch.ay = p.y; }
    return;
  }
  mouse.x = p.x; mouse.y = p.y; mouse.seen = true;
});
const endPointer = (e) => {
  if (e.pointerId === touch.moveId) touch.moveId = null;
  if (e.pointerId === touch.aimId) touch.aimId = null;
  if (e.pointerType !== 'touch' && e.button === 0) mouse.down = false;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

function enableTouch() {
  if (touch.enabled) return;
  touch.enabled = true;
  document.body.classList.add('touch');
}
$('#btnDash').addEventListener('pointerdown', (e) => { e.preventDefault(); actions.dash = true; });
$('#btnShhh').addEventListener('pointerdown', (e) => { e.preventDefault(); actions.shhh = true; });
$('#btnPause').addEventListener('click', () => (game.state === 'playing' ? pause() : null));

function pollGamepad() {
  const gps = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const g of gps) if (g) { gp = g; break; }
  if (!gp) { pad.connected = false; pad.fire = false; return; }
  pad.connected = true;
  const dz = (v) => (Math.abs(v || 0) < 0.22 ? 0 : v);
  pad.mx = dz(gp.axes[0]); pad.my = dz(gp.axes[1]);
  pad.ax = dz(gp.axes[2]); pad.ay = dz(gp.axes[3]);
  const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
  pad.fire = Math.hypot(pad.ax, pad.ay) > 0.35 || b(7);
  for (const i of [0, 1, 4, 5, 9, 12, 13, 14, 15]) {
    if (b(i) && !pad.prev[i]) onPadPress(i);
    pad.prev[i] = b(i);
  }
}
function onPadPress(i) {
  sound.init();
  if (game.state === 'playing') {
    if (i === 0 || i === 5) actions.dash = true;
    if (i === 1 || i === 4) actions.shhh = true;
    if (i === 9) pause();
    return;
  }
  if (game.state === 'paused' && i === 9) return resume();
  // Menu navigation: move focus between visible buttons, A to activate.
  const btns = [...document.querySelectorAll('.screen:not([hidden]) button:not([disabled])')];
  if (!btns.length) return;
  const cur = btns.indexOf(document.activeElement);
  if (i === 12 || i === 14) btns[(cur - 1 + btns.length) % btns.length].focus();
  else if (i === 13 || i === 15) btns[(cur + 1) % btns.length].focus();
  else if (i === 0) (cur >= 0 ? btns[cur] : btns[0]).click();
}

// ======================================================================
// World state
// ======================================================================
const game = {
  state: 'title', wave: 0, score: 0, kills: 0, combo: 0, comboT: 0, bestCombo: 0, time: 0, playTime: 0,
  seed: 1, freeze: 0, timeScale: 1, trauma: 0, flash: 0, banner: '', bannerSub: '', bannerT: 0,
  owned: {}, noHitWave: true, clearT: 0, boss: null, deathT: 0, waveT: 0, ammoT: 0, ammo: null,
};
let stats = baseStats();
let player = makePlayer();
let arena = generateArena(1, 1);
let flow = null, flowCell = -1, flowT = 0;
let bg = null;
let rng = new Rng(1);
let spawnQueue = [];
const enemies = [], books = [], hazards = [], rings = [], particles = [], texts = [], pickups = [], telegraphs = [], flashes = [];

function makePlayer() {
  return { x: W / 2, y: H / 2, vx: 0, vy: 0, r: 11, hp: 5, aim: 0, fireT: 0, dashT: 0, dashCd: 0, dx: 1, dy: 0,
    inv: 0, shhhT: 0, rapidT: 0, walk: 0, trail: [] };
}

const comboMult = () => Math.min(4, 1 + Math.floor(game.combo / 5) * 0.5);

// ======================================================================
// Run / wave flow
// ======================================================================
function startRun() {
  sound.init();
  game.seed = (Math.random() * 1e9) | 0;
  rng = new Rng(game.seed);
  Object.assign(game, { wave: 0, score: 0, kills: 0, combo: 0, comboT: 0, bestCombo: 0, playTime: 0, owned: {},
    freeze: 0, timeScale: 1, trauma: 0, flash: 0, boss: null });
  stats = baseStats();
  player = makePlayer();
  player.hp = stats.maxHp;
  startWave(1);
}

function startWave(n) {
  game.wave = n;
  for (const arr of [enemies, books, hazards, rings, telegraphs, pickups]) arr.length = 0;
  arena = generateArena(game.seed, n);
  buildBackground();
  flowCell = -1;
  player.x = W / 2; player.y = H / 2; player.vx = player.vy = 0;
  spawnQueue = composeWave(n, rng).spawns;
  game.waveT = 0; game.noHitWave = true; game.boss = null;
  game.ammo = pickBook(); game.ammoT = 0;
  banner(`WAVE ${n}`, n % 5 === 0 ? 'A rogue author approaches…' : `“${short(game.ammo.title, 40)}” is loaded`);
  sound.setIntensity(1); sound.setMuffled(false);
  game.state = 'playing';
  showScreen(null);
}

function banner(text, sub = '') { game.banner = text; game.bannerSub = sub; game.bannerT = 2.4; }

function waveCleared() {
  const bonus = 250 * game.wave + (game.noHitWave ? 500 : 0);
  game.score += bonus;
  banner('SHELF CLEARED!', `+${bonus.toLocaleString()} ${game.noHitWave ? '(flawless bonus!)' : ''}`);
  sound.play('wave');
  game.state = 'waveclear';
  game.clearT = 1.8;
  // Vacuum up leftover pickups for convenience.
  for (const p of pickups) p.magnet = true;
}

function showUpgrades() {
  game.state = 'upgrade';
  sound.setMuffled(true);
  const choices = rollUpgrades(rng, game.owned, 3);
  if (!choices.length) return startWave(game.wave + 1);
  const box = $('#cards');
  box.textContent = '';
  $('#upgradeTitle').textContent = `Wave ${game.wave} cleared — choose a perk`;
  choices.forEach((u, i) => {
    const b = document.createElement('button');
    b.className = 'card';
    const lvl = (game.owned[u.id] || 0) + 1;
    b.innerHTML = `<span class="key">${i + 1}</span><span class="icon"></span><strong></strong><span class="desc"></span><span class="lvl"></span>`;
    b.querySelector('.icon').textContent = u.icon;
    b.querySelector('strong').textContent = u.name;
    b.querySelector('.desc').textContent = u.desc;
    b.querySelector('.lvl').textContent = `Level ${lvl} / ${u.max}`;
    b.addEventListener('click', () => {
      game.owned[u.id] = lvl;
      u.apply(stats, player);
      sound.play('upgrade');
      startWave(game.wave + 1);
    });
    box.appendChild(b);
  });
  showScreen('upgrade');
  box.querySelector('button').focus();
}

function pause() {
  if (game.state !== 'playing') return;
  game.state = 'paused';
  sound.setMuffled(true);
  mouse.down = false;
  showScreen('pause');
  $('#pause button').focus();
}
function resume() {
  if (game.state !== 'paused') return;
  game.state = 'playing';
  sound.setMuffled(false);
  showScreen(null);
}

function die() {
  game.state = 'dying';
  game.deathT = 1.8;
  game.timeScale = 0.25;
  sound.play('death');
  sound.setIntensity(0);
  burst(player.x, player.y, 60, ['#2bb3a3', '#f1c27d', '#fff'], 260, 1.2);
  addLight(player.x, player.y, 300, 1.2);
  shake(1);
}

// ======================================================================
// Spawning
// ======================================================================
const DEF = {
  bunny: { r: 11, hp: 2, speed: 88, score: 50 },
  notice: { r: 10, hp: 1, speed: 150, score: 70 },
  patron: { r: 14, hp: 5, speed: 70, score: 150 },
  worm: { r: 9, hp: 2, speed: 105, score: 40 },
  golem: { r: 22, hp: 14, speed: 42, score: 300 },
  coin: { r: 7, hp: 1, speed: 140, score: 20 },
  boss: { r: 40, hp: 1, speed: 60, score: 2000 },
};

function makeEnemy(type, x, y, extra = {}) {
  const d = DEF[type];
  const hpScale = 1 + Math.max(0, game.wave - 1) * 0.08;
  const hp = Math.max(1, Math.round(d.hp * (d.hp > 1 ? hpScale : 1)));
  const e = { type, x, y, vx: 0, vy: 0, r: d.r, hp, maxHp: hp, speed: d.speed * (1 + Math.min(0.35, game.wave * 0.015)),
    score: d.score, t: Math.random() * 10, stun: 0, flash: 0, dead: false, leader: null, atkT: 1.5 + Math.random() * 1.5, orbitHit: 0, ...extra };
  enemies.push(e);
  return e;
}

function spawnPoint() {
  const cells = edgeCells(arena.solid);
  for (let i = 0; i < 20; i++) {
    const [cx, cy] = cells[(Math.random() * cells.length) | 0];
    const x = cx * CELL + CELL / 2, y = cy * CELL + CELL / 2;
    if (Math.hypot(x - player.x, y - player.y) > 260) return { x, y };
  }
  return { x: 15, y: 15 };
}

function updateSpawning(dt) {
  game.waveT += dt;
  while (spawnQueue.length && spawnQueue[0].t <= game.waveT) {
    const s = spawnQueue.shift();
    const p = s.type === 'boss' ? { x: W / 2, y: 130 } : spawnPoint();
    telegraphs.push({ type: s.type, x: p.x, y: p.y, t: 0, dur: s.type === 'boss' ? 1.6 : 0.85 });
    sound.play('spawn');
  }
  for (let i = telegraphs.length - 1; i >= 0; i--) {
    const tg = telegraphs[i];
    tg.t += dt;
    if (tg.t >= tg.dur) {
      telegraphs.splice(i, 1);
      materialise(tg.type, tg.x, tg.y);
    }
  }
}

function materialise(type, x, y) {
  burst(x, y, 14, ['#b48cff', '#fff'], 120, 0.5);
  if (type === 'worm') {
    let prev = makeEnemy('worm', x, y, { hp: Math.round(4 * (1 + game.wave * 0.08)), head: true });
    prev.maxHp = prev.hp;
    for (let i = 0; i < 6; i++) prev = makeEnemy('worm', x, y, { leader: prev });
  } else if (type === 'boss') {
    const hp = 170 + game.wave * 30;
    const e = makeEnemy('boss', x, y, { hp, maxHp: hp, name: pickAuthor(), atkT: 2, spiral: 0, summonT: 6, mode: 'idle', modeT: 0 });
    game.boss = e;
    banner(`ROGUE AUTHOR`, e.name);
    sound.play('boss'); sound.setIntensity(2);
    shake(0.7);
  } else makeEnemy(type, x, y);
}

// ======================================================================
// Effects helpers
// ======================================================================
function shake(a) { if (settings.motion) game.trauma = Math.min(1, game.trauma + a); }
function addLight(x, y, r, life, color = null) { flashes.push({ x, y, r, life, max: life, color }); }
function floatText(x, y, text, color = '#fff', size = 14, life = 0.8) {
  texts.push({ x, y, text, color, size, life, max: life, vy: -40 });
}
function particle(p) { if (particles.length < 700) particles.push(p); }
function burst(x, y, n, colors, speed = 160, life = 0.6, shape = 'sq') {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, s = speed * (0.3 + Math.random() * 0.7);
    particle({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * (0.5 + Math.random() * 0.5), max: life,
      size: 2 + Math.random() * 3, color: colors[(Math.random() * colors.length) | 0], drag: 3, rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 12, shape });
  }
}
function pages(x, y, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, s = 60 + Math.random() * 140;
    particle({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.9, max: 0.9, size: 5, color: '#f3ead2', drag: 2.5, rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 10, shape: 'page' });
  }
}

// ======================================================================
// Update
// ======================================================================
function step(dt) {
  game.time += dt;
  if (game.freeze > 0) { game.freeze -= dt; return; }
  if (game.state !== 'dying') game.timeScale = Math.min(1, game.timeScale + dt * 2);
  const sdt = dt * game.timeScale;
  if (game.state === 'playing' || game.state === 'waveclear') game.playTime += dt;
  game.trauma = Math.max(0, game.trauma - dt * 1.5);
  game.flash = Math.max(0, game.flash - dt * 2.5);
  game.bannerT = Math.max(0, game.bannerT - dt);

  if (game.state === 'playing') updateSpawning(sdt);
  if (game.state !== 'dying') updatePlayer(sdt);
  updateFlow(dt);
  updateEnemies(sdt);
  updateBooks(sdt);
  updateOrbiters(sdt);
  updateHazards(sdt);
  updateRings(sdt);
  updatePickups(sdt);
  updateParticles(sdt);

  if (game.comboT > 0) { game.comboT -= sdt; if (game.comboT <= 0) game.combo = 0; }
  game.ammoT += sdt;
  if (game.ammoT > 7) { game.ammoT = 0; game.ammo = pickBook(); }

  if (game.state === 'playing' && !spawnQueue.length && !telegraphs.length && !enemies.length) waveCleared();
  if (game.state === 'waveclear') { game.clearT -= dt; if (game.clearT <= 0) showUpgrades(); }
  if (game.state === 'dying') { game.deathT -= dt; if (game.deathT <= 0) showGameOver(); }
  actions.dash = actions.shhh = false;
}

function moveInput() {
  let x = 0, y = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
  if (pad.connected && (pad.mx || pad.my)) { x = pad.mx; y = pad.my; }
  if (touch.moveId !== null) { x = (touch.mx - touch.mx0) / 45; y = (touch.my - touch.my0) / 45; }
  const l = Math.hypot(x, y);
  return l > 1 ? { x: x / l, y: y / l } : { x, y };
}

function nearestEnemy(x, y, maxD = Infinity) {
  let best = null, bd = maxD * maxD;
  for (const e of enemies) {
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function updatePlayer(dt) {
  const p = player;
  const mv = moveInput();
  // Aim: gamepad stick > touch aim > auto-aim (touch) > mouse
  let firing = false;
  if (pad.connected && (pad.ax || pad.ay)) { p.aim = Math.atan2(pad.ay, pad.ax); firing = pad.fire; }
  else if (touch.aimId !== null) { p.aim = Math.atan2(touch.ay - p.y, touch.ax - p.x); firing = true; }
  else if (touch.enabled || (pad.connected && !mouse.seen)) {
    const t = nearestEnemy(p.x, p.y, 420);
    if (t) { p.aim = Math.atan2(t.y - p.y, t.x - p.x); firing = true; }
  } else {
    p.aim = Math.atan2(mouse.y - p.y, mouse.x - p.x);
    firing = mouse.down;
  }
  if (pad.fire) firing = true;
  if (settings.autofire && enemies.length) firing = true;
  if (game.state !== 'playing') firing = false;

  p.inv = Math.max(0, p.inv - dt);
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.shhhT = Math.max(0, p.shhhT - dt);
  p.rapidT = Math.max(0, p.rapidT - dt);

  if (actions.dash && p.dashCd <= 0 && game.state !== 'dying') {
    const l = Math.hypot(mv.x, mv.y);
    p.dx = l ? mv.x / l : Math.cos(p.aim); p.dy = l ? mv.y / l : Math.sin(p.aim);
    p.dashT = 0.17; p.dashCd = stats.dashCd;
    sound.play('dash');
    burst(p.x, p.y, 8, ['#9be7dc', '#fff'], 90, 0.3);
  }
  if (actions.shhh && game.state === 'playing') doShhh();

  if (p.dashT > 0) {
    p.dashT -= dt;
    p.vx = p.dx * stats.speed * 3.3; p.vy = p.dy * stats.speed * 3.3;
    p.trail.push({ x: p.x, y: p.y, a: p.aim, life: 0.25 });
  } else {
    const k = 1 - Math.exp(-dt * 14);
    p.vx = lerp(p.vx, mv.x * stats.speed, k);
    p.vy = lerp(p.vy, mv.y * stats.speed, k);
  }
  p.x += p.vx * dt; p.y += p.vy * dt;
  collideWorld(p, p.r);
  p.walk += Math.hypot(p.vx, p.vy) * dt * 0.08;
  for (let i = p.trail.length - 1; i >= 0; i--) if ((p.trail[i].life -= dt) <= 0) p.trail.splice(i, 1);

  p.fireT -= dt;
  const rate = stats.fireRate * (p.rapidT > 0 ? 2 : 1);
  if (firing && p.fireT <= 0) { p.fireT = 1 / rate; fire(); }
}

function collideWorld(o, r) {
  let hit = null;
  for (const rect of arena.rects) {
    const n = pushCircleOutOfRect(o, r, rect);
    if (n) hit = n;
  }
  if (o.x < r) { o.x = r; hit = { nx: 1, ny: 0 }; }
  if (o.x > W - r) { o.x = W - r; hit = { nx: -1, ny: 0 }; }
  if (o.y < r) { o.y = r; hit = { nx: 0, ny: 1 }; }
  if (o.y > H - r) { o.y = H - r; hit = { nx: 0, ny: -1 }; }
  return hit;
}
function fire() {
  const p = player, n = stats.projectiles;
  const book = game.ammo || pickBook();
  for (let i = 0; i < n; i++) {
    const a = p.aim + (i - (n - 1) / 2) * stats.spread + (Math.random() - 0.5) * 0.04;
    books.push({ x: p.x + Math.cos(a) * 14, y: p.y + Math.sin(a) * 14, vx: Math.cos(a) * stats.projSpeed, vy: Math.sin(a) * stats.projSpeed,
      r: 6, life: 1.3, rot: a, spin: (Math.random() < 0.5 ? -1 : 1) * 14, bounces: stats.bounces, pierce: stats.pierce,
      hit: new Set(), color: bookColor(book.title), title: book.title });
  }
  sound.play('throw');
}

function doShhh() {
  const p = player;
  if (p.shhhT > 0) return;
  p.shhhT = stats.shhhCd;
  const R = stats.shhhRadius;
  rings.push({ x: p.x, y: p.y, r: 8, max: R, speed: 700, friendly: true, life: 1 });
  for (const e of enemies) {
    const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
    if (d < R + e.r) {
      const kb = e.type === 'boss' ? 60 : 420;
      e.vx += (dx / d) * kb; e.vy += (dy / d) * kb;
      e.stun = e.type === 'boss' ? 0.4 : 1.5;
      damageEnemy(e, 1, 0, 0, false);
    }
  }
  for (let i = hazards.length - 1; i >= 0; i--) {
    const h = hazards[i];
    if (Math.hypot(h.x - p.x, h.y - p.y) < R) { burst(h.x, h.y, 4, ['#ff6b6b', '#fff'], 80, 0.3); hazards.splice(i, 1); }
  }
  floatText(p.x, p.y - 26, 'SHHH!', '#9be7dc', 22, 1);
  sound.play('shhh');
  shake(0.35);
  addLight(p.x, p.y, R * 1.4, 0.5, '#9be7dc');
}

function updateFlow(dt) {
  flowT -= dt;
  const [cx, cy] = cellOf(player.x, player.y);
  const c = idx(cx, cy);
  if (c !== flowCell || flowT <= 0 || !flow) {
    flow = computeFlowField(arena.solid, COLS, ROWS, cx, cy);
    flowCell = c; flowT = 0.5;
  }
}

/** Direction toward the player: straight line if visible, otherwise follow the flow field. */
function seek(e) {
  const dx = player.x - e.x, dy = player.y - e.y, d = Math.hypot(dx, dy) || 1;
  if (lineOfSight(arena.solid, COLS, ROWS, CELL, e.x, e.y, player.x, player.y)) return { x: dx / d, y: dy / d, d };
  const [cx, cy] = cellOf(e.x, e.y);
  const i = idx(cx, cy);
  const fx = flow.dirX[i], fy = flow.dirY[i];
  if (!fx && !fy) return { x: dx / d, y: dy / d, d };
  // Aim at the centre of the next cell to avoid scraping shelf corners.
  const tx = (cx + fx + 0.5) * CELL - e.x, ty = (cy + fy + 0.5) * CELL - e.y, tl = Math.hypot(tx, ty) || 1;
  return { x: tx / tl, y: ty / tl, d };
}

function updateEnemies(dt) {
  const p = player;
  for (const e of enemies) {
    e.t += dt;
    e.flash = Math.max(0, e.flash - dt);
    e.orbitHit = Math.max(0, e.orbitHit - dt);
    // Knockback decays
    const kd = Math.exp(-dt * 6);
    e.vx *= kd; e.vy *= kd;
    let mx = 0, my = 0;
    if (e.stun > 0) { e.stun -= dt; }
    else if (game.state === 'dying') { /* freeze AI */ }
    else switch (e.type) {
      case 'bunny': {
        const s = seek(e); const hop = 0.55 + 0.75 * Math.abs(Math.sin(e.t * 7));
        mx = s.x * e.speed * hop; my = s.y * e.speed * hop; break;
      }
      case 'notice': {
        const s = seek(e); const w = Math.sin(e.t * 6) * 0.9;
        mx = (s.x - s.y * w) * e.speed; my = (s.y + s.x * w) * e.speed; break;
      }
      case 'coin': { const s = seek(e); mx = s.x * e.speed; my = s.y * e.speed; break; }
      case 'golem': { const s = seek(e); mx = s.x * e.speed; my = s.y * e.speed; break; }
      case 'patron': {
        const s = seek(e);
        const dir = s.d < 190 ? -1 : s.d > 260 ? 1 : 0;
        const strafe = Math.sin(e.t * 0.8) > 0 ? 1 : -1;
        mx = (s.x * dir - s.y * strafe * 0.6) * e.speed; my = (s.y * dir + s.x * strafe * 0.6) * e.speed;
        e.atkT -= dt;
        if (e.atkT <= 0) {
          e.atkT = Math.max(1.6, 3 - game.wave * 0.06);
          rings.push({ x: e.x, y: e.y, r: e.r, max: 280, speed: 140, width: 12, life: 1 });
          sound.play('ring');
        }
        break;
      }
      case 'worm': {
        if (e.leader && !e.leader.dead) {
          const L = e.leader, dx = e.x - L.x, dy = e.y - L.y, d = Math.hypot(dx, dy) || 1;
          if (d > 15) { e.x = L.x + (dx / d) * 15; e.y = L.y + (dy / d) * 15; }
        } else {
          if (e.leader) { e.leader = null; e.head = true; }
          const s = seek(e); const w = Math.sin(e.t * 5) * 0.5;
          mx = (s.x - s.y * w) * e.speed; my = (s.y + s.x * w) * e.speed;
        }
        break;
      }
      case 'boss': bossAI(e, dt); break;
    }
    if (e.type !== 'boss' || e.mode !== 'charge') { e.x += (mx + e.vx) * dt; e.y += (my + e.vy) * dt; }
  }
  // Separation (cheap O(n²); n stays < ~100) + world collision
  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i];
    for (let j = i + 1; j < enemies.length; j++) {
      const b = enemies[j];
      if (a.type === 'worm' && b.type === 'worm') continue;
      const dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r, d2 = dx * dx + dy * dy;
      if (d2 < min * min && d2 > 0.01) {
        const d = Math.sqrt(d2), push = (min - d) / 2, nx = dx / d, ny = dy / d;
        const wa = a.type === 'boss' ? 0 : 1, wb = b.type === 'boss' ? 0 : 1;
        a.x -= nx * push * wa * (wb ? 1 : 2); a.y -= ny * push * wa * (wb ? 1 : 2);
        b.x += nx * push * wb * (wa ? 1 : 2); b.y += ny * push * wb * (wa ? 1 : 2);
      }
    }
  }
  for (const e of enemies) {
    if (e.type === 'boss') { e.x = clamp(e.x, e.r, W - e.r); e.y = clamp(e.y, e.r, H - e.r); }
    else if (!(e.type === 'worm' && e.leader)) collideWorld(e, e.r);
    // Contact damage
    if (game.state === 'playing' || game.state === 'waveclear') {
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy);
      if (d < p.r + e.r - 3) hurtPlayer(e.x, e.y);
    }
  }
  for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].dead) enemies.splice(i, 1);
}

function bossAI(e, dt) {
  const p = player;
  const frac = e.hp / e.maxHp;
  const phase = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3;
  if (phase !== e.phase) {
    if (e.phase) { banner(`PHASE ${phase}`, phase === 3 ? 'The author is furious!' : 'Plot thickens…'); shake(0.5); sound.play('boss'); }
    e.phase = phase;
  }
  const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
  const aim = Math.atan2(dy, dx);
  e.modeT -= dt;
  if (e.mode === 'windup') {
    e.x += (Math.random() - 0.5) * 3; e.y += (Math.random() - 0.5) * 3;
    if (e.modeT <= 0) { e.mode = 'charge'; e.modeT = 0.75; e.cdx = Math.cos(e.cAim); e.cdy = Math.sin(e.cAim); sound.play('dash'); }
    return;
  }
  if (e.mode === 'charge') {
    e.x += e.cdx * 430 * dt; e.y += e.cdy * 430 * dt;
    particle({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.4, max: 0.4, size: 14, color: '#6c3cff', drag: 0, rot: 0, vr: 0, shape: 'circ' });
    const hitWall = e.x < e.r || e.x > W - e.r || e.y < e.r || e.y > H - e.r;
    if (hitWall || e.modeT <= 0) {
      e.mode = 'idle'; e.modeT = 0;
      e.x = clamp(e.x, e.r, W - e.r); e.y = clamp(e.y, e.r, H - e.r);
      if (hitWall) { shake(0.6); sound.play('explode'); radial(e.x, e.y, 14, 170, 0); }
    }
    return;
  }
  // Drift to keep a menacing distance
  const want = d > 220 ? 1 : d < 150 ? -1 : 0;
  e.x += ((dx / d) * want * e.speed + Math.cos(e.t * 0.7) * 30) * dt;
  e.y += ((dy / d) * want * e.speed + Math.sin(e.t * 0.9) * 20) * dt;
  e.atkT -= dt;
  if (phase === 1 && e.atkT <= 0) { e.atkT = 1.25; fan(e.x, e.y, aim, 5, 0.22, 210); }
  if (phase === 2) {
    e.spiral += dt * 2.3;
    if (e.atkT <= 0) { e.atkT = 0.11; for (const o of [0, Math.PI]) shootHazard(e.x, e.y, e.spiral + o, 165); }
    e.summonT -= dt;
    if (e.summonT <= 0) { e.summonT = 7; for (let i = 0; i < 3; i++) telegraphs.push({ type: 'bunny', ...spawnPoint(), t: 0, dur: 0.85 }); }
  }
  if (phase === 3) {
    if (e.atkT <= 0) {
      if (Math.random() < 0.5) { e.mode = 'windup'; e.modeT = 0.6; e.cAim = aim; e.atkT = 2.2; }
      else { e.atkT = 1.4; radial(e.x, e.y, 18, 190, e.t); fan(e.x, e.y, aim, 3, 0.15, 260); }
    }
  }
}
function shootHazard(x, y, a, s) { hazards.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: 5, life: 6, rot: a }); }
function fan(x, y, a, n, spread, s) { for (let i = 0; i < n; i++) shootHazard(x, y, a + (i - (n - 1) / 2) * spread, s); sound.play('shoot'); }
function radial(x, y, n, s, off) { for (let i = 0; i < n; i++) shootHazard(x, y, off + (i / n) * TAU, s); sound.play('shoot'); }

function damageEnemy(e, dmg, kx, ky, crit) {
  if (e.dead) return;
  e.hp -= dmg;
  e.flash = 0.09;
  const kbScale = e.type === 'boss' ? 0.05 : e.type === 'golem' ? 0.3 : 1;
  e.vx += kx * kbScale; e.vy += ky * kbScale;
  floatText(e.x + (Math.random() - 0.5) * 10, e.y - e.r, crit ? `${dmg}!` : `${dmg}`, crit ? '#ffd54a' : '#fff', crit ? 18 : 12, 0.6);
  sound.play(crit ? 'crit' : 'hit', e.type === 'boss' ? 0.6 : 1);
  if (e.type === 'boss') game.freeze = Math.max(game.freeze, 0.012);
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  e.dead = true;
  game.kills++;
  game.combo++;
  game.comboT = 2.5;
  game.bestCombo = Math.max(game.bestCombo, game.combo);
  const gained = Math.round(e.score * comboMult());
  game.score += gained;
  const colors = { bunny: ['#c9c2b6', '#8d867a'], notice: ['#f4efe1', '#e74c3c'], patron: ['#ff9f43', '#ffd8a8'], worm: ['#7bd88f', '#3c8d50'],
    golem: ['#d4a017', '#8a6d1a'], coin: ['#ffd54a'], boss: ['#6c3cff', '#b48cff', '#fff'] }[e.type];
  burst(e.x, e.y, e.type === 'boss' ? 90 : 16, colors, e.type === 'boss' ? 360 : 170, e.type === 'boss' ? 1.4 : 0.6);
  pages(e.x, e.y, e.type === 'boss' ? 40 : 3);
  addLight(e.x, e.y, e.r * 5, 0.35, colors[0]);
  sound.play('kill', 1 + Math.min(game.combo, 20) * 0.03);
  if (game.combo > 0 && game.combo % 10 === 0) floatText(player.x, player.y - 34, `${game.combo} COMBO!`, '#ffd54a', 18, 1.1);
  else if (Math.random() < 0.18 && game.ammo) floatText(e.x, e.y - 18, `“${short(game.ammo.title, 22)}”`, '#e8d9b0', 10, 1);
  if (e.type === 'golem') {
    for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU; const c = makeEnemy('coin', e.x + Math.cos(a) * 14, e.y + Math.sin(a) * 14); c.vx = Math.cos(a) * 200; c.vy = Math.sin(a) * 200; }
    shake(0.3);
  }
  if (e.type === 'boss') {
    game.boss = null;
    game.timeScale = 0.2; game.freeze = 0.15;
    shake(1); game.flash = 0.6;
    sound.play('explode'); sound.setIntensity(1);
    hazards.length = 0;
    banner('AUTHOR DEFEATED', `${e.name} has been… shelved.`);
    pickups.push({ type: 'heart', x: e.x, y: e.y, t: 0, life: 20 });
  }
  // Drops
  if (e.type !== 'worm' || Math.random() < 0.3) {
    const r = Math.random();
    if (r < 0.035 && player.hp < stats.maxHp) pickups.push({ type: 'heart', x: e.x, y: e.y, t: 0, life: 10 });
    else if (r < 0.06) pickups.push({ type: 'coffee', x: e.x, y: e.y, t: 0, life: 10 });
  }
}

function hurtPlayer(sx, sy) {
  const p = player;
  if (p.inv > 0 || p.dashT > 0 || game.state === 'dying' || game.state === 'gameover') return;
  p.hp -= 1;
  p.inv = stats.iframes;
  game.noHitWave = false;
  game.combo = 0; game.comboT = 0;
  const dx = p.x - sx, dy = p.y - sy, d = Math.hypot(dx, dy) || 1;
  p.vx += (dx / d) * 380; p.vy += (dy / d) * 380;
  shake(0.6); game.flash = 0.5; game.freeze = 0.07;
  sound.play('hurt');
  burst(p.x, p.y, 18, ['#ff6b6b', '#fff'], 200, 0.5);
  if (p.hp <= 0) die();
}

function updateBooks(dt) {
  for (let i = books.length - 1; i >= 0; i--) {
    const b = books[i];
    b.life -= dt;
    b.rot += b.spin * dt;
    if (stats.homing > 0) {
      const t = nearestEnemy(b.x, b.y, 240);
      if (t) {
        const cur = Math.atan2(b.vy, b.vx), want = Math.atan2(t.y - b.y, t.x - b.x);
        const na = cur + clamp(angleDiff(cur, want), -stats.homing * dt, stats.homing * dt);
        const s = Math.hypot(b.vx, b.vy);
        b.vx = Math.cos(na) * s; b.vy = Math.sin(na) * s;
      }
    }
    const ox = b.x, oy = b.y;
    b.x += b.vx * dt; b.y += b.vy * dt;
    let remove = b.life <= 0;
    if (isSolidPx(arena.solid, b.x, b.y)) {
      if (b.bounces > 0) {
        b.bounces--;
        // Reflect on the axis whose crossing put us into the wall.
        if (isSolidPx(arena.solid, b.x, oy)) b.vx = -b.vx;
        if (isSolidPx(arena.solid, ox, b.y)) b.vy = -b.vy;
        if (!isSolidPx(arena.solid, b.x, oy) && !isSolidPx(arena.solid, ox, b.y)) { b.vx = -b.vx; b.vy = -b.vy; }
        b.x = ox; b.y = oy;
        sound.play('ping');
      } else { remove = true; pages(b.x, b.y, 2); }
    }
    if (!remove) {
      for (const e of enemies) {
        if (e.dead || b.hit.has(e)) continue;
        const rr = e.r + b.r;
        if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 < rr * rr) {
          b.hit.add(e);
          const crit = Math.random() < stats.critChance;
          const dmg = crit ? Math.ceil(stats.damage * 2.5) : stats.damage;
          const s = Math.hypot(b.vx, b.vy) || 1;
          damageEnemy(e, dmg, (b.vx / s) * 160, (b.vy / s) * 160, crit);
          burst(b.x, b.y, 5, [b.color, '#fff'], 120, 0.3);
          if (b.pierce > 0) b.pierce--; else { remove = true; break; }
        }
      }
    }
    if (remove) books.splice(i, 1);
  }
}

function orbiterPositions() {
  const n = stats.orbiters, out = [];
  for (let i = 0; i < n; i++) {
    const a = game.time * 3.2 + (i / n) * TAU;
    out.push({ x: player.x + Math.cos(a) * 48, y: player.y + Math.sin(a) * 48, a });
  }
  return out;
}
function updateOrbiters() {
  if (!stats.orbiters || game.state === 'dying') return;
  for (const o of orbiterPositions()) {
    for (const e of enemies) {
      if (e.dead || e.orbitHit > 0) continue;
      if ((e.x - o.x) ** 2 + (e.y - o.y) ** 2 < (e.r + 8) ** 2) {
        e.orbitHit = 0.35;
        const dx = e.x - player.x, dy = e.y - player.y, d = Math.hypot(dx, dy) || 1;
        damageEnemy(e, stats.damage, (dx / d) * 220, (dy / d) * 220, false);
      }
    }
  }
}

function updateHazards(dt) {
  for (let i = hazards.length - 1; i >= 0; i--) {
    const h = hazards[i];
    h.life -= dt; h.x += h.vx * dt; h.y += h.vy * dt; h.rot += dt * 6;
    let remove = h.life <= 0 || h.x < -20 || h.x > W + 20 || h.y < -20 || h.y > H + 20;
    if (!remove && isSolidPx(arena.solid, h.x, h.y) && h.x > 0 && h.y > 0 && h.x < W && h.y < H) { remove = true; burst(h.x, h.y, 3, ['#ff6b6b'], 60, 0.25); }
    if (!remove && (h.x - player.x) ** 2 + (h.y - player.y) ** 2 < (h.r + player.r - 2) ** 2 && player.inv <= 0 && player.dashT <= 0) {
      hurtPlayer(h.x, h.y); remove = true;
    }
    if (remove) hazards.splice(i, 1);
  }
}

function updateRings(dt) {
  for (let i = rings.length - 1; i >= 0; i--) {
    const g = rings[i];
    g.r += g.speed * dt;
    g.life = 1 - g.r / g.max;
    if (!g.friendly) {
      const d = Math.hypot(player.x - g.x, player.y - g.y);
      if (Math.abs(d - g.r) < g.width / 2 + player.r * 0.5) hurtPlayer(g.x, g.y);
    }
    if (g.r >= g.max) rings.splice(i, 1);
  }
}

function updatePickups(dt) {
  const p = player;
  for (let i = pickups.length - 1; i >= 0; i--) {
    const k = pickups[i];
    k.t += dt; k.life -= dt;
    const dx = p.x - k.x, dy = p.y - k.y, d = Math.hypot(dx, dy) || 1;
    if (d < 90 || k.magnet) { const s = k.magnet ? 500 : 260; k.x += (dx / d) * s * dt; k.y += (dy / d) * s * dt; }
    if (d < p.r + 10) {
      if (k.type === 'heart') { p.hp = Math.min(stats.maxHp, p.hp + 1); floatText(p.x, p.y - 22, '+1 ♥', '#ff6b81', 16); }
      else { p.rapidT = 6; floatText(p.x, p.y - 22, 'ESPRESSO RUSH!', '#c69c6d', 16); }
      sound.play('pickup');
      burst(k.x, k.y, 12, [k.type === 'heart' ? '#ff6b81' : '#c69c6d', '#fff'], 120, 0.4);
      pickups.splice(i, 1);
    } else if (k.life <= 0) pickups.splice(i, 1);
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const q = particles[i];
    q.life -= dt;
    if (q.life <= 0) { particles[i] = particles[particles.length - 1]; particles.pop(); continue; }
    const d = Math.exp(-q.drag * dt);
    q.vx *= d; q.vy *= d; q.x += q.vx * dt; q.y += q.vy * dt; q.rot += q.vr * dt;
  }
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i];
    t.life -= dt; t.y += t.vy * dt; t.vy *= Math.exp(-dt * 2);
    if (t.life <= 0) texts.splice(i, 1);
  }
  for (let i = flashes.length - 1; i >= 0; i--) if ((flashes[i].life -= dt) <= 0) flashes.splice(i, 1);
}

// ======================================================================
// Rendering
// ======================================================================
const BOOK_PALETTE = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#d35400', '#16a085', '#f1c40f', '#7f8c8d', '#e84393', '#2c3e50', '#b33939', '#218c74'];

function buildBackground() {
  bg = document.createElement('canvas');
  bg.width = W * 2; bg.height = H * 2; // render at 2x for crispness on HiDPI
  const g = bg.getContext('2d');
  g.scale(2, 2);
  const r = new Rng(hashString(`bg:${game.seed}:${game.wave}`));
  // Wooden floor planks
  const ph = 18;
  for (let y = 0; y < H; y += ph) {
    let x = -r.int(0, 120);
    while (x < W) {
      const len = r.int(90, 210);
      const l = r.int(16, 23);
      g.fillStyle = `hsl(25 35% ${l}%)`;
      g.fillRect(x, y, len, ph);
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, len, ph);
      g.strokeStyle = 'rgba(255,220,180,0.05)';
      for (let k = 0; k < 3; k++) { const gy = y + 3 + r.int(0, ph - 6); g.beginPath(); g.moveTo(x + 4, gy); g.lineTo(x + len - 4, gy + r.float(-1, 1)); g.stroke(); }
      x += len;
    }
  }
  // Central rug
  const rx = SAFE.x0 * CELL + 6, ry = SAFE.y0 * CELL + 6, rw = (SAFE.x1 - SAFE.x0 + 1) * CELL - 12, rh = (SAFE.y1 - SAFE.y0 + 1) * CELL - 12;
  g.fillStyle = '#4a1622'; g.fillRect(rx, ry, rw, rh);
  g.strokeStyle = '#c9a227'; g.lineWidth = 3; g.strokeRect(rx + 6, ry + 6, rw - 12, rh - 12);
  g.lineWidth = 1; g.strokeRect(rx + 12, ry + 12, rw - 24, rh - 24);
  g.save(); g.translate(rx + rw / 2, ry + rh / 2);
  for (let i = 0; i < 8; i++) { g.rotate(TAU / 8); g.fillStyle = 'rgba(201,162,39,0.35)'; g.beginPath(); g.ellipse(26, 0, 18, 6, 0, 0, TAU); g.fill(); }
  g.restore();
  // Shelves: shadow, frame, spines
  for (const s of arena.rects) {
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(s.x + 6, s.y + 8, s.w, s.h);
    g.fillStyle = '#5b3a1e'; g.fillRect(s.x, s.y, s.w, s.h);
    g.fillStyle = '#24160b'; g.fillRect(s.x + 3, s.y + 3, s.w - 6, s.h - 6);
    const horiz = s.w >= s.h;
    let p = 4;
    const lenAxis = horiz ? s.w : s.h;
    while (p < lenAxis - 6) {
      const thick = r.int(4, 8);
      const depth = (horiz ? s.h : s.w) - 6 - r.int(0, 5);
      g.fillStyle = r.pick(BOOK_PALETTE);
      if (horiz) g.fillRect(s.x + p, s.y + 3 + ((s.h - 6) - depth), thick - 1, depth);
      else g.fillRect(s.x + 3 + ((s.w - 6) - depth), s.y + p, depth, thick - 1);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      if (horiz) g.fillRect(s.x + p, s.y + 3 + ((s.h - 6) - depth) + 3, thick - 1, 2);
      else g.fillRect(s.x + 3 + ((s.w - 6) - depth) + 3, s.y + p, 2, thick - 1);
      p += thick;
    }
    g.strokeStyle = '#8a5a2b'; g.lineWidth = 2; g.strokeRect(s.x + 1, s.y + 1, s.w - 2, s.h - 2);
  }
  // Reading lamps in the corners (also light sources)
  for (const [x, y] of LAMPS) {
    g.fillStyle = '#2b1d10'; g.beginPath(); g.arc(x, y, 12, 0, TAU); g.fill();
    g.fillStyle = '#ffd27a'; g.beginPath(); g.arc(x, y, 7, 0, TAU); g.fill();
  }
  // Walls
  g.strokeStyle = '#120b06'; g.lineWidth = 10; g.strokeRect(0, 0, W, H);
}
const LAMPS = [[44, 44], [W - 44, 44], [44, H - 44], [W - 44, H - 44]];

// Light layer: darkness with "holes" punched by light sprites (destination-out), at half resolution.
const LS = 0.5;
const lightCanvas = document.createElement('canvas');
lightCanvas.width = W * LS; lightCanvas.height = H * LS;
const lctx = lightCanvas.getContext('2d');
const lightSprite = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return c;
})();
const glowCache = new Map();
function glowSprite(color) {
  if (glowCache.has(color)) return glowCache.get(color);
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  glowCache.set(color, c); return c;
}

function renderLights() {
  const darkness = game.state === 'title' ? 0.55 : game.boss && game.boss.phase === 3 ? 0.86 + Math.sin(game.time * 23) * 0.04 : 0.8;
  lctx.globalCompositeOperation = 'source-over';
  lctx.clearRect(0, 0, lightCanvas.width, lightCanvas.height);
  lctx.fillStyle = `rgba(6,4,18,${darkness})`;
  lctx.fillRect(0, 0, lightCanvas.width, lightCanvas.height);
  lctx.globalCompositeOperation = 'destination-out';
  const L = (x, y, r, a = 1) => { lctx.globalAlpha = clamp(a, 0, 1); lctx.drawImage(lightSprite, (x - r) * LS, (y - r) * LS, r * 2 * LS, r * 2 * LS); };
  for (const [x, y] of LAMPS) L(x, y, 170 + Math.sin(game.time * 3 + x) * 4, 0.8);
  L(W / 2, H / 2, 200, 0.35);
  if (game.state !== 'gameover' && !(game.state === 'dying' && game.deathT < 1.2)) L(player.x, player.y, 230, 1);
  for (const b of books) L(b.x, b.y, 55, 0.7);
  for (const h of hazards) L(h.x, h.y, 30, 0.5);
  for (const e of enemies) if (e.type === 'boss') L(e.x, e.y, 160, 0.7); else if (e.type === 'golem') L(e.x, e.y, 60, 0.4);
  for (const g of rings) L(g.x, g.y, g.r + 30, 0.3 * g.life);
  for (const t of telegraphs) L(t.x, t.y, 70, t.t / t.dur);
  for (const f of flashes) L(f.x, f.y, f.r, f.life / f.max);
  lctx.globalAlpha = 1;
  ctx.drawImage(lightCanvas, 0, 0, W, H);
  // Coloured additive glows on top
  ctx.globalCompositeOperation = 'lighter';
  const G = (x, y, r, c, a) => { ctx.globalAlpha = a; ctx.drawImage(glowSprite(c), x - r, y - r, r * 2, r * 2); };
  for (const [x, y] of LAMPS) G(x, y, 90, 'rgba(255,190,90,0.6)', 0.5);
  for (const b of books) G(b.x, b.y, 22, b.color, 0.5);
  for (const h of hazards) G(h.x, h.y, 18, 'rgba(255,80,80,1)', 0.6);
  for (const f of flashes) if (f.color) G(f.x, f.y, f.r * 0.6, f.color, 0.6 * (f.life / f.max));
  if (game.boss) G(game.boss.x, game.boss.y, 120, 'rgba(120,70,255,1)', 0.35);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function render() {
  const s = viewScale * dpr;
  const tr = game.trauma * game.trauma;
  const ox = settings.motion ? (Math.random() * 2 - 1) * tr * 14 : 0;
  const oy = settings.motion ? (Math.random() * 2 - 1) * tr * 14 : 0;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#05030c'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(s, 0, 0, s, ox * s, oy * s);
  if (bg) ctx.drawImage(bg, 0, 0, W, H);

  for (const t of telegraphs) drawTelegraph(t);
  for (const k of pickups) drawPickup(k);
  for (const e of enemies) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(e.x + 3, e.y + e.r * 0.8, e.r * 0.9, e.r * 0.4, 0, 0, TAU); ctx.fill(); }
  for (let i = enemies.length - 1; i >= 0; i--) drawEnemy(enemies[i]);
  for (const b of books) drawBook(b.x, b.y, b.rot, b.color, 1);
  if (game.state !== 'title' && game.state !== 'gameover' && !(game.state === 'dying' && game.deathT < 1.5)) {
    for (const o of orbiterPositions()) drawBook(o.x, o.y, o.a * 2, '#b48cff', 1.1);
    drawPlayer();
  }
  for (const h of hazards) drawHazard(h);
  for (const g of rings) drawRing(g);
  drawParticles();

  if (settings.lights) renderLights();

  for (const t of texts) {
    ctx.globalAlpha = clamp(t.life / t.max * 1.5, 0, 1);
    ctx.font = `bold ${t.size}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(t.text, t.x, t.y);
    ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;

  // Screen-space UI (no shake)
  ctx.setTransform(s, 0, 0, s, 0, 0);
  if (game.flash > 0) {
    ctx.fillStyle = `rgba(255,40,60,${(settings.motion ? 0.35 : 0.15) * game.flash})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (game.state !== 'title') drawHUD();
  if (touch.enabled && touch.moveId !== null) drawStick();
  if (!touch.enabled && mouse.seen && (game.state === 'playing' || game.state === 'waveclear')) drawCrosshair();
}

function drawBook(x, y, rot, color, scale) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(scale, scale);
  ctx.fillStyle = color; ctx.fillRect(-7, -5, 14, 10);
  ctx.fillStyle = '#f3ead2'; ctx.fillRect(-5, -4, 11, 8);
  ctx.fillStyle = color; ctx.fillRect(-7, -5, 3, 10);
  ctx.restore();
}

function drawPlayer() {
  const p = player;
  for (const t of p.trail) {
    ctx.globalAlpha = t.life * 1.6;
    ctx.fillStyle = '#9be7dc'; ctx.beginPath(); ctx.arc(t.x, t.y, p.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = p.inv > 0 && Math.floor(game.time * 18) % 2 ? 0.35 : 1;
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(p.x + 3, p.y + 10, 12, 5, 0, 0, TAU); ctx.fill();
  ctx.save(); ctx.translate(p.x, p.y + Math.sin(p.walk) * 1.2); ctx.rotate(p.aim);
  // Cardigan body
  ctx.fillStyle = p.rapidT > 0 ? '#c69c6d' : '#2bb3a3';
  ctx.beginPath(); ctx.ellipse(0, 0, 10, 13, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#13544c'; ctx.lineWidth = 2; ctx.stroke();
  // Arm + book in hand
  ctx.fillStyle = '#2bb3a3'; ctx.fillRect(4, 7, 9, 5);
  ctx.fillStyle = game.ammo ? bookColor(game.ammo.title) : '#c0392b'; ctx.fillRect(11, 5, 7, 9);
  // Head, bun, glasses
  ctx.fillStyle = '#4a2c1a'; ctx.beginPath(); ctx.arc(-6, 0, 5, 0, TAU); ctx.fill();
  ctx.fillStyle = '#f1c27d'; ctx.beginPath(); ctx.arc(1, 0, 7, 0, TAU); ctx.fill();
  ctx.fillStyle = '#4a2c1a'; ctx.beginPath(); ctx.arc(-1, 0, 7, Math.PI * 0.55, Math.PI * 1.45); ctx.fill();
  ctx.strokeStyle = '#222'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(5, -3, 2.4, 0, TAU); ctx.moveTo(7.4, 3); ctx.arc(5, 3, 2.4, 0, TAU); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(5, -4, 1.5, 1.5); ctx.fillRect(5, 2, 1.5, 1.5);
  ctx.restore();
  ctx.globalAlpha = 1;
}

function eyes(x, y, sep, r, look, color = '#fff') {
  for (const s of [-1, 1]) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x + s * sep, y, r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(x + s * sep + Math.cos(look) * r * 0.4, y + Math.sin(look) * r * 0.4, r * 0.5, 0, TAU); ctx.fill();
  }
}

function drawEnemy(e) {
  const look = Math.atan2(player.y - e.y, player.x - e.x);
  ctx.save(); ctx.translate(e.x, e.y);
  if (e.stun > 0) { ctx.rotate(Math.sin(e.t * 20) * 0.15); }
  const white = e.flash > 0;
  switch (e.type) {
    case 'bunny': {
      const sq = 1 + Math.sin(e.t * 14) * 0.08;
      ctx.scale(1 / sq, sq);
      ctx.fillStyle = white ? '#fff' : '#c9c2b6';
      for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU + e.t; ctx.beginPath(); ctx.arc(Math.cos(a) * 7, Math.sin(a) * 7, 6, 0, TAU); ctx.fill(); }
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill();
      eyes(0, -1, 4, 3, look);
      break;
    }
    case 'notice': {
      ctx.rotate(Math.sin(e.t * 6) * 0.5);
      ctx.scale(Math.abs(Math.cos(e.t * 4)) * 0.5 + 0.6, 1);
      ctx.fillStyle = white ? '#fff' : '#f4efe1'; ctx.fillRect(-9, -11, 18, 22);
      ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2; ctx.strokeRect(-6, -3, 12, 7);
      ctx.fillStyle = '#c0392b'; ctx.fillRect(-6, -8, 12, 2);
      ctx.fillStyle = '#999'; ctx.fillRect(-6, 7, 9, 1.5);
      break;
    }
    case 'patron': {
      const charge = e.atkT < 0.5 ? 1 + (0.5 - e.atkT) * 0.6 : 1;
      ctx.scale(charge, charge);
      ctx.fillStyle = white ? '#fff' : '#ff9f43'; ctx.beginPath(); ctx.arc(0, 0, 14, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#b85c12'; ctx.lineWidth = 2; ctx.stroke();
      eyes(0, -5, 5, 3, look);
      ctx.fillStyle = '#3a0d0d'; ctx.beginPath(); ctx.ellipse(0, 5, 6, 4 + Math.abs(Math.sin(e.t * 12)) * 3, 0, 0, TAU); ctx.fill();
      break;
    }
    case 'worm': {
      const head = !e.leader;
      ctx.fillStyle = white ? '#fff' : head ? '#ff8fb1' : '#7bd88f';
      ctx.beginPath(); ctx.arc(0, 0, head ? 11 : 9, 0, TAU); ctx.fill();
      ctx.strokeStyle = head ? '#b34d6d' : '#3c8d50'; ctx.lineWidth = 2; ctx.stroke();
      if (head) {
        eyes(0, -2, 4, 3, look);
        ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-7, -2); ctx.lineTo(7, -2); ctx.stroke();
      }
      break;
    }
    case 'golem': {
      ctx.fillStyle = white ? '#fff' : '#b8860b';
      ctx.beginPath(); ctx.roundRect(-20, -20, 40, 40, 8); ctx.fill();
      ctx.strokeStyle = '#6b4f0c'; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = '#6b4f0c'; ctx.font = 'bold 22px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('$', 0, 4);
      eyes(0, -10, 8, 3, look, '#ffef9f');
      ctx.textBaseline = 'alphabetic';
      if (e.hp < e.maxHp) { ctx.fillStyle = '#000'; ctx.fillRect(-18, 24, 36, 4); ctx.fillStyle = '#ffd54a'; ctx.fillRect(-18, 24, 36 * (e.hp / e.maxHp), 4); }
      break;
    }
    case 'coin': {
      ctx.scale(Math.abs(Math.cos(e.t * 8)) * 0.7 + 0.3, 1);
      ctx.fillStyle = white ? '#fff' : '#ffd54a'; ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 2; ctx.stroke();
      break;
    }
    case 'boss': drawBoss(e, look, white); break;
  }
  ctx.restore();
}

function drawBoss(e, look, white) {
  const flap = Math.sin(e.t * 6) * 0.25;
  if (e.mode === 'windup') { ctx.strokeStyle = 'rgba(255,60,60,0.7)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(e.cAim) * 600, Math.sin(e.cAim) * 600); ctx.stroke(); }
  // Open tome: two covers + pages
  for (const s of [-1, 1]) {
    ctx.save(); ctx.scale(s, 1); ctx.rotate(flap * s * 0.3);
    ctx.fillStyle = white ? '#fff' : '#3b1d8f'; ctx.beginPath(); ctx.roundRect(0, -34, 46, 68, 6); ctx.fill();
    ctx.fillStyle = '#f3ead2'; ctx.fillRect(3, -30, 38, 60);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
    for (let y = -24; y < 26; y += 6) { ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(36, y); ctx.stroke(); }
    ctx.restore();
  }
  ctx.fillStyle = '#2a0f66'; ctx.fillRect(-3, -36, 6, 72);
  // The eye
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(0, 0, 17, 12, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = e.phase === 3 ? '#ff2d55' : '#6c3cff'; ctx.beginPath(); ctx.arc(Math.cos(look) * 6, Math.sin(look) * 4, 7, 0, TAU); ctx.fill();
  ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(Math.cos(look) * 7, Math.sin(look) * 5, 3, 0, TAU); ctx.fill();
}

function drawTelegraph(t) {
  const k = t.t / t.dur;
  const r = t.type === 'boss' ? 46 : 16;
  ctx.strokeStyle = `rgba(180,140,255,${0.3 + k * 0.6})`; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(t.x, t.y, r * (1.6 - k * 0.6), 0, TAU); ctx.stroke();
  ctx.fillStyle = `rgba(180,140,255,${k * 0.35})`; ctx.beginPath(); ctx.arc(t.x, t.y, r * k, 0, TAU); ctx.fill();
}

function drawPickup(k) {
  const bob = Math.sin(k.t * 5) * 2;
  if (k.life < 3 && Math.floor(k.t * 10) % 2) return;
  if (k.type === 'heart') { ctx.fillStyle = '#ff6b81'; heartPath(ctx, k.x, k.y - 8 + bob, 14); ctx.fill(); }
  else {
    ctx.fillStyle = '#f3ead2'; ctx.fillRect(k.x - 6, k.y - 6 + bob, 12, 13);
    ctx.fillStyle = '#6f4e37'; ctx.fillRect(k.x - 5, k.y - 5 + bob, 10, 4);
    ctx.strokeStyle = '#f3ead2'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(k.x + 7, k.y + bob, 3, -1.2, 1.2); ctx.stroke();
  }
}

function drawHazard(h) {
  ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(h.rot);
  ctx.fillStyle = '#ffdddd'; ctx.fillRect(-5, -6, 10, 12);
  ctx.fillStyle = '#d63031'; ctx.fillRect(-4, -3, 8, 2); ctx.fillRect(-4, 1, 8, 2);
  ctx.restore();
}

function drawRing(g) {
  ctx.strokeStyle = g.friendly ? `rgba(155,231,220,${g.life})` : `rgba(255,159,67,${0.4 + g.life * 0.6})`;
  ctx.lineWidth = g.friendly ? 6 * g.life + 1 : g.width;
  ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, TAU); ctx.stroke();
  if (!g.friendly) { ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.stroke(); }
}

function drawParticles() {
  for (const q of particles) {
    ctx.globalAlpha = clamp(q.life / q.max, 0, 1);
    ctx.fillStyle = q.color;
    if (q.shape === 'circ') { ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (q.life / q.max), 0, TAU); ctx.fill(); }
    else if (q.shape === 'page') {
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot); ctx.scale(Math.cos(q.rot * 2), 1);
      ctx.fillRect(-q.size, -q.size * 0.7, q.size * 2, q.size * 1.4); ctx.restore();
    } else ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
  }
  ctx.globalAlpha = 1;
}

function heartPath(g, x, y, s) {
  g.beginPath();
  g.moveTo(x, y + s * 0.3);
  g.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
  g.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.8, x, y + s);
  g.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
  g.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3);
  g.closePath();
}

const FONT = (px, w = 'bold') => `${w} ${px}px ui-monospace, Menlo, Consolas, monospace`;
function txt(t, x, y, px, color, align = 'left') {
  ctx.font = FONT(px); ctx.textAlign = align;
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(t, x, y);
  ctx.fillStyle = color; ctx.fillText(t, x, y);
}

function drawHUD() {
  // Hearts
  if (stats.maxHp <= 12) {
    for (let i = 0; i < stats.maxHp; i++) {
      ctx.fillStyle = i < player.hp ? '#ff6b81' : 'rgba(255,255,255,0.15)';
      heartPath(ctx, 22 + i * 24, 12, 18); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  } else {
    ctx.fillStyle = '#ff6b81'; heartPath(ctx, 22, 12, 18); ctx.fill();
    txt(`× ${player.hp}`, 38, 28, 16, '#fff');
  }
  // Score + combo
  txt(Math.floor(game.score).toLocaleString(), W - 16, 32, 24, '#fff', 'right');
  const m = comboMult();
  if (game.combo > 1) {
    txt(`${game.combo} combo  ×${m}`, W - 16, 52, 13, m >= 3 ? '#ffd54a' : '#9be7dc', 'right');
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(W - 136, 58, 120, 4);
    ctx.fillStyle = '#9be7dc'; ctx.fillRect(W - 136, 58, 120 * clamp(game.comboT / 2.5, 0, 1), 4);
  }
  // Wave info
  const left = enemies.length + telegraphs.length + spawnQueue.length;
  txt(`WAVE ${game.wave}`, W / 2, 26, 18, '#e8d9b0', 'center');
  if (game.state === 'playing' && !game.boss) txt(`${left} disturbance${left === 1 ? '' : 's'} left`, W / 2, 44, 11, 'rgba(232,217,176,0.8)', 'center');
  // Cooldowns
  cooldown(30, H - 30, 'DASH', 1 - player.dashCd / stats.dashCd, '#9be7dc');
  cooldown(80, H - 30, 'SHHH', 1 - player.shhhT / stats.shhhCd, '#b48cff');
  if (player.rapidT > 0) cooldown(130, H - 30, '☕x2', player.rapidT / 6, '#c69c6d');
  // Ammo ticker
  if (game.ammo && !game.boss) {
    ctx.globalAlpha = 0.85;
    txt(`📖 “${short(game.ammo.title, 44)}”${game.ammo.author ? ' — ' + short(game.ammo.author, 20) : ''}`, W / 2, H - 14, 11, '#e8d9b0', 'center');
    ctx.globalAlpha = 1;
  }
  // Boss bar
  if (game.boss) {
    const b = game.boss, bw = 460, bx = (W - bw) / 2, by = H - 34;
    txt(`${b.name}`, W / 2, by - 6, 13, '#d6c8ff', 'center');
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx - 2, by - 2, bw + 4, 14);
    ctx.fillStyle = b.phase === 3 ? '#ff2d55' : '#6c3cff'; ctx.fillRect(bx, by, bw * clamp(b.hp / b.maxHp, 0, 1), 10);
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(bx + bw * 0.33, by, 2, 10); ctx.fillRect(bx + bw * 0.66, by, 2, 10);
  }
  // Banner
  if (game.bannerT > 0) {
    const a = clamp(Math.min(game.bannerT, 2.4 - game.bannerT) * 3, 0, 1);
    const slide = (1 - a) * 30;
    ctx.globalAlpha = a;
    txt(game.banner, W / 2 + slide, H / 2 - 50, 44, '#fff3c4', 'center');
    if (game.bannerSub) txt(game.bannerSub, W / 2 - slide, H / 2 - 22, 16, '#d6c8ff', 'center');
    ctx.globalAlpha = 1;
  }
  if (DEBUG) txt(`fps ${fps.toFixed(0)}  e${enemies.length} p${particles.length} seed ${game.seed}`, 10, H - 60, 11, '#0f0');
}

function cooldown(x, y, label, k, color) {
  k = clamp(k, 0, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(x, y, 18, 0, TAU); ctx.fill();
  ctx.strokeStyle = k >= 1 ? color : 'rgba(255,255,255,0.3)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(x, y, 16, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
  ctx.font = FONT(9); ctx.textAlign = 'center'; ctx.fillStyle = k >= 1 ? '#fff' : '#999'; ctx.fillText(label, x, y + 3);
}

function drawCrosshair() {
  const x = mouse.x, y = mouse.y;
  ctx.strokeStyle = 'rgba(255,243,196,0.9)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, 8, 0, TAU);
  ctx.moveTo(x - 13, y); ctx.lineTo(x - 5, y); ctx.moveTo(x + 5, y); ctx.lineTo(x + 13, y);
  ctx.moveTo(x, y - 13); ctx.lineTo(x, y - 5); ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 13);
  ctx.stroke();
}

function drawStick() {
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(touch.mx0, touch.my0, 45, 0, TAU); ctx.stroke();
  const dx = touch.mx - touch.mx0, dy = touch.my - touch.my0, d = Math.hypot(dx, dy), k = d > 45 ? 45 / d : 1;
  ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.arc(touch.mx0 + dx * k, touch.my0 + dy * k, 18, 0, TAU); ctx.fill();
}

// ======================================================================
// DOM screens, settings, leaderboard
// ======================================================================
const SCREENS = ['title', 'howto', 'settings', 'leaderboard', 'upgrade', 'pause', 'gameover'];
let settingsReturn = 'title';
function showScreen(id) {
  for (const s of SCREENS) $('#' + s).hidden = s !== id;
  document.body.classList.toggle('in-game', id === null);
}

function setSetting(k, v) {
  settings[k] = v;
  saveJSON(SETTINGS_KEY, settings);
  if (k === 'sfx') sound.setSfx(v);
  if (k === 'music') sound.setMusic(v);
  const box = document.querySelector(`#settings input[data-k="${k}"]`);
  if (box) box.checked = v;
}
document.querySelectorAll('#settings input[data-k]').forEach((box) => {
  box.checked = !!settings[box.dataset.k];
  box.addEventListener('change', () => setSetting(box.dataset.k, box.checked));
});

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 1600);
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  sound.init(); sound.play('click');
  const act = b.dataset.act;
  if (act === 'play' || act === 'again') startRun();
  else if (act === 'howto') showScreen('howto');
  else if (act === 'settings') { settingsReturn = game.state === 'paused' ? 'pause' : 'title'; showScreen('settings'); }
  else if (act === 'leaderboard') { showScreen('leaderboard'); loadLeaderboard($('#lbList')); }
  else if (act === 'back') showScreen(game.state === 'paused' ? settingsReturn : 'title');
  else if (act === 'resume') resume();
  else if (act === 'quit') { game.state = 'title'; sound.setIntensity(0); sound.setMuffled(false); enemies.length = 0; showScreen('title'); }
  else if (act === 'menu') { game.state = 'title'; showScreen('title'); }
});

async function loadLeaderboard(list, highlight = null) {
  list.textContent = '';
  const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'Checking the records…'; list.appendChild(li);
  try {
    const r = await fetch('/api/scores?limit=10');
    if (!r.ok) throw new Error(r.status);
    const rows = await r.json();
    list.textContent = '';
    if (!rows.length) { li.textContent = 'No scores yet — be the first!'; list.appendChild(li); return; }
    rows.forEach((row, i) => {
      const el = document.createElement('li');
      if (highlight && row.name === highlight.name && row.score === highlight.score) el.className = 'me';
      const rank = document.createElement('span'); rank.textContent = `#${i + 1}`;
      const name = document.createElement('span'); name.textContent = row.name;
      const sc = document.createElement('span'); sc.textContent = `${row.score.toLocaleString()} · W${row.wave}`;
      el.append(rank, name, sc);
      list.appendChild(el);
    });
  } catch {
    li.textContent = 'Leaderboard unavailable (is the library server running?)';
  }
}

const BEST_KEY = 'overdue.best.v1';
function showGameOver() {
  game.state = 'gameover';
  sound.setMuffled(true);
  const score = Math.floor(game.score);
  const best = loadJSON(BEST_KEY);
  const isBest = score > (best.score || 0);
  if (isBest) saveJSON(BEST_KEY, { score, wave: game.wave });
  $('#goStats').innerHTML = '';
  const rows = [
    ['Score', score.toLocaleString() + (isBest ? ' ★ new personal best' : '')],
    ['Wave reached', game.wave], ['Disturbances shushed', game.kills], ['Best combo', game.bestCombo],
    ['Time on shift', `${Math.floor(game.playTime / 60)}m ${Math.floor(game.playTime % 60)}s`],
    ['Perks', Object.keys(game.owned).length ? Object.entries(game.owned).map(([k, v]) => `${k}×${v}`).join(', ') : 'none'],
  ];
  for (const [k, v] of rows) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = String(v);
    $('#goStats').append(dt, dd);
  }
  const form = $('#scoreForm');
  form.hidden = false;
  $('#submitMsg').textContent = '';
  $('#nameInput').value = loadJSON('overdue.name.v1').name || '';
  showScreen('gameover');
  loadLeaderboard($('#goList'));
  $('#nameInput').focus();
}

$('#scoreForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#nameInput').value.trim();
  const msg = $('#submitMsg');
  if (!/^[A-Za-z0-9 _-]{1,12}$/.test(name)) { msg.textContent = 'Name: 1–12 letters, numbers, spaces, _ or -'; return; }
  saveJSON('overdue.name.v1', { name });
  const payload = { name, score: Math.floor(game.score), wave: game.wave, kills: game.kills, durationMs: Math.floor(game.playTime * 1000) };
  const btn = e.submitter || $('#scoreForm button');
  btn.disabled = true; msg.textContent = 'Filing your record…';
  try {
    const r = await fetch('/api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Server said ${r.status}`);
    msg.textContent = `Filed! You rank #${data.rank} in the Hall of Fame.`;
    $('#scoreForm').hidden = true;
    loadLeaderboard($('#goList'), payload);
  } catch (err) {
    msg.textContent = `Couldn't submit: ${err.message}`;
  } finally { btn.disabled = false; }
});

// ======================================================================
// Main loop (fixed 120 Hz simulation, render every animation frame)
// ======================================================================
const STEP = 1 / 120;
let last = performance.now(), acc = 0, fps = 60;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fps = lerp(fps, 1 / Math.max(dt, 1e-3), 0.05);
  pollGamepad();
  if (game.state === 'playing' || game.state === 'waveclear' || game.state === 'dying') {
    acc += dt;
    while (acc >= STEP) { acc -= STEP; step(STEP); }
  } else {
    acc = 0;
    game.time += dt;
    updateParticles(dt);
  }
  render();
}

buildBackground();
updateSourceBadge();
showScreen('title');
document.body.classList.add('ready');
requestAnimationFrame(frame);

// Test hooks (only with ?debug) — used by the automated Playwright smoke test.
if (DEBUG) {
  window.__overdue = {
    game, get player() { return player; }, get stats() { return stats; }, enemies, get content() { return content; },
    startRun, startWave, killAll: () => { for (const e of [...enemies]) killEnemy(e); spawnQueue.length = 0; telegraphs.length = 0; },
    god: () => { player.hp = 999; stats.maxHp = 999; }, die: () => { player.hp = 1; player.inv = 0; hurtPlayer(player.x + 1, player.y); },
  };
}
