// 100% procedural audio: every sound effect and the adaptive soundtrack are synthesised
// with the Web Audio API at runtime — no audio files are shipped.

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// i – VI – III – VII in A minor: Am, F, C, G
const PROGRESSION = [
  { root: 45, triad: [0, 3, 7] },
  { root: 41, triad: [0, 4, 7] },
  { root: 48, triad: [0, 4, 7] },
  { root: 43, triad: [0, 4, 7] },
];
const PENTA = [0, 3, 5, 7, 10, 12, 15, 17];

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.musicOn = true;
    this.intensity = 0;
    this.lastPlay = {};
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.leadNote = 0;
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(comp);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.sfxOn ? 0.55 : 0; this.sfx.connect(this.master);
    // Music runs through a low-pass so menus/pauses can "muffle" it.
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 18000;
    this.muffle.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = this.musicOn ? 0.32 : 0; this.music.connect(this.muffle);
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startMusic();
  }

  setSfx(on) { this.sfxOn = on; if (this.sfx) this.sfx.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.05); }
  setMusic(on) { this.musicOn = on; if (this.music) this.music.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.1); }
  setMuffled(m) { if (this.muffle) this.muffle.frequency.setTargetAtTime(m ? 700 : 18000, this.ctx.currentTime, 0.15); }
  setIntensity(level) { this.intensity = level; }

  // ---------- primitives ----------
  tone({ type = 'square', f = 440, f2 = null, dur = 0.1, vol = 0.3, at = 0, attack = 0.005, dest = null, detune = 0 }) {
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.detune.value = detune;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.sfx);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise({ dur = 0.2, vol = 0.3, type = 'lowpass', f = 2000, f2 = null, q = 1, at = 0, dest = null, attack = 0.003 }) {
    const c = this.ctx, t = c.currentTime + at;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const fl = c.createBiquadFilter(); fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(dest || this.sfx);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  // ---------- sound effects ----------
  play(name, p = 1) {
    if (!this.ctx || !this.sfxOn) return;
    const now = this.ctx.currentTime;
    const minGap = { hit: 0.03, throw: 0.035, kill: 0.025, ping: 0.05 }[name] || 0;
    if (minGap && now - (this.lastPlay[name] || 0) < minGap) return;
    this.lastPlay[name] = now;
    const r = 1 + (Math.random() - 0.5) * 0.12; // slight pitch variance keeps repeats fresh
    switch (name) {
      case 'throw': this.noise({ dur: 0.07, vol: 0.12, type: 'bandpass', f: 1800 * r, f2: 600, q: 2 }); this.tone({ type: 'triangle', f: 520 * r, f2: 300, dur: 0.06, vol: 0.06 }); break;
      case 'hit': this.tone({ type: 'square', f: 300 * r * p, f2: 140, dur: 0.06, vol: 0.12 }); this.noise({ dur: 0.05, vol: 0.12, f: 3000 }); break;
      case 'crit': this.tone({ type: 'square', f: 880 * r, f2: 1320, dur: 0.08, vol: 0.12 }); this.tone({ type: 'square', f: 300, f2: 120, dur: 0.08, vol: 0.12 }); break;
      case 'kill': this.tone({ type: 'square', f: 660 * r * p, f2: 990 * p, dur: 0.07, vol: 0.12 }); this.noise({ dur: 0.12, vol: 0.18, type: 'highpass', f: 1500, f2: 5000 }); break;
      case 'explode': this.noise({ dur: 0.6, vol: 0.5, f: 1600, f2: 80, q: 0.8 }); this.tone({ type: 'sine', f: 120, f2: 35, dur: 0.5, vol: 0.5 }); break;
      case 'dash': this.noise({ dur: 0.18, vol: 0.22, type: 'bandpass', f: 500, f2: 3500, q: 1.5 }); break;
      case 'hurt': this.tone({ type: 'sawtooth', f: 400, f2: 70, dur: 0.35, vol: 0.3 }); this.noise({ dur: 0.25, vol: 0.3, f: 900 }); break;
      case 'shhh': this.noise({ dur: 0.9, vol: 0.45, type: 'bandpass', f: 4200, f2: 3000, q: 3, attack: 0.06 }); this.tone({ type: 'sine', f: 90, f2: 40, dur: 0.5, vol: 0.4 }); break;
      case 'pickup': [0, 4, 7, 12].forEach((s, i) => this.tone({ type: 'triangle', f: midiHz(76 + s), dur: 0.12, vol: 0.14, at: i * 0.05 })); break;
      case 'upgrade': [0, 7, 12, 16, 19].forEach((s, i) => this.tone({ type: 'square', f: midiHz(64 + s), dur: 0.18, vol: 0.08, at: i * 0.06 })); break;
      case 'wave': [0, 3, 7, 10, 12].forEach((s, i) => this.tone({ type: 'triangle', f: midiHz(69 + s), dur: 0.22, vol: 0.14, at: i * 0.08 })); break;
      case 'spawn': this.tone({ type: 'sine', f: 200 * r, f2: 600, dur: 0.25, vol: 0.05 }); break;
      case 'ring': this.tone({ type: 'sawtooth', f: 180 * r, f2: 90, dur: 0.3, vol: 0.1 }); break;
      case 'shoot': this.tone({ type: 'square', f: 240 * r, f2: 180, dur: 0.05, vol: 0.05 }); break;
      case 'boss': this.tone({ type: 'sawtooth', f: 70, f2: 45, dur: 1.4, vol: 0.4, attack: 0.1 }); this.tone({ type: 'sawtooth', f: 105, f2: 66, dur: 1.4, vol: 0.3, attack: 0.1, detune: 12 }); this.noise({ dur: 1.4, vol: 0.25, f: 400, f2: 100, attack: 0.2 }); break;
      case 'death': this.tone({ type: 'triangle', f: 440, f2: 55, dur: 1.4, vol: 0.4 }); this.noise({ dur: 1.2, vol: 0.3, f: 1200, f2: 60 }); break;
      case 'ping': this.tone({ type: 'sine', f: 1200 * r, dur: 0.05, vol: 0.05 }); break;
      case 'click': this.tone({ type: 'square', f: 900, dur: 0.03, vol: 0.05 }); break;
    }
  }

  // ---------- adaptive music (look-ahead scheduler) ----------
  startMusic() {
    if (this.timer) return;
    this.bpm = 116;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  schedule() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const stepDur = 60 / this.bpm / 4;
    while (this.nextTime < c.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime - c.currentTime, stepDur);
      this.step = (this.step + 1) % 64;
      this.nextTime += stepDur;
    }
  }

  playStep(step, at, sd) {
    if (!this.musicOn) return;
    const lvl = this.intensity;
    const s = step % 16;
    const chord = PROGRESSION[Math.floor(step / 16)];
    const m = this.music;
    if (s === 0) {
      // Soft pad — always on.
      chord.triad.forEach((iv) => this.tone({ type: 'triangle', f: midiHz(chord.root + 12 + iv), dur: sd * 16, vol: lvl ? 0.04 : 0.07, at, attack: 0.3, dest: m }));
    }
    if (lvl >= 1 && [0, 3, 6, 8, 11, 14].includes(s)) {
      this.tone({ type: 'sawtooth', f: midiHz(chord.root - 12 + (s === 8 ? 12 : 0)), dur: sd * 1.6, vol: 0.16, at, dest: m });
    }
    const arpEvery = lvl >= 2 ? 1 : lvl >= 1 ? 2 : 4;
    if (s % arpEvery === 0) {
      const pat = [0, 1, 2, 1, 2, 0, 2, 1];
      const iv = chord.triad[pat[(s / arpEvery) % pat.length]] + (s >= 8 ? 12 : 0);
      this.tone({ type: 'square', f: midiHz(chord.root + 24 + iv), dur: sd * 0.9, vol: lvl ? 0.05 : 0.035, at, dest: m });
    }
    if (lvl >= 1 && s % 4 === 2) this.noise({ dur: 0.04, vol: 0.08, type: 'highpass', f: 7000, at, dest: m });
    if (lvl >= 2) {
      if (s % 4 === 0) this.tone({ type: 'sine', f: 150, f2: 40, dur: 0.18, vol: 0.5, at, dest: m });
      if (s === 4 || s === 12) this.noise({ dur: 0.14, vol: 0.2, type: 'bandpass', f: 1800, q: 0.7, at, dest: m });
      if (s % 2 === 0 && Math.random() < 0.7) {
        this.leadNote = Math.max(0, Math.min(PENTA.length - 1, this.leadNote + Math.floor(Math.random() * 3) - 1));
        this.tone({ type: 'sawtooth', f: midiHz(57 + 12 + PENTA[this.leadNote]), dur: sd * 1.8, vol: 0.05, at, dest: m, detune: 7 });
      }
    } else if (lvl >= 1 && s % 8 === 0) {
      this.tone({ type: 'sine', f: 130, f2: 45, dur: 0.15, vol: 0.3, at, dest: m });
    }
  }
}
