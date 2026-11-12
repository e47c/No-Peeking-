// ===== NO PEEKING! sound design =====
// Everything is synthesized (no files). One musical key (D major pentatonic) so every
// sound agrees with every other. Voices: marimba, FM bell, brass stab, woodblock, stamp, applause.
const KEY = "np_audio_v2";
const st = { vol: 0.75, music: true, muted: false };
try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch {}
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };

let ctx = null, master = null, sfxBus = null, musicBus = null, nbuf = null;
const D4 = 293.66;
const nt = (semi) => D4 * Math.pow(2, semi / 12); // semitones above D4
const now = () => ctx.currentTime;

function apply(instant) {
  if (!ctx) return;
  const v = st.muted ? 0 : st.vol * st.vol; // perceptual curve
  if (instant) { master.gain.value = v; musicBus.gain.value = st.music ? 1 : 0; return; }
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(v, t, 0.04);
  musicBus.gain.setTargetAtTime(st.music ? 1 : 0, t, 0.15);
}

export const audio = {
  get state() { return { ...st }; },
  get ready() { return !!ctx && ctx.state === "running"; },
  // Browsers only allow sound after a click/tap. We call this on the first one.
  unlock() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
        master = ctx.createGain(); sfxBus = ctx.createGain(); musicBus = ctx.createGain();
        sfxBus.connect(master); musicBus.connect(master); master.connect(comp); comp.connect(ctx.destination);
        nbuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = nbuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        apply(true);
      }
      if (ctx.state === "suspended") ctx.resume().then(() => music.refresh()).catch(() => {});
      else music.refresh();
    } catch {}
  },
  setVolume(v) { st.vol = Math.min(1, Math.max(0, v)); persist(); apply(); },
  setMusic(b) { st.music = !!b; persist(); apply(); music.refresh(); },
  setMuted(b) { st.muted = !!b; persist(); apply(); },
};

// ---------- voices ----------
function adsr(g, t, a, d, peak) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function osc(type, f, t, d, v, o = {}) {
  const { a = 0.004, to = null, out = sfxBus, lp = null, det = 0 } = o;
  const os = ctx.createOscillator(), g = ctx.createGain();
  os.type = type;
  os.frequency.setValueAtTime(f, t);
  if (to) os.frequency.exponentialRampToValueAtTime(to, t + d);
  if (det) os.detune.value = det;
  adsr(g, t, a, d, v);
  let n = os;
  if (lp) { const fl = ctx.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = lp; os.connect(fl); n = fl; }
  n.connect(g); g.connect(out);
  os.start(t); os.stop(t + a + d + 0.05);
}
function nz(t, d, v, o = {}) {
  const { type = "bandpass", f = 1000, to = null, q = 1, out = sfxBus, a = 0.004 } = o;
  const s = ctx.createBufferSource();
  s.buffer = nbuf; s.loop = true;
  const fl = ctx.createBiquadFilter();
  fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, t);
  if (to) fl.frequency.exponentialRampToValueAtTime(to, t + d);
  const g = ctx.createGain();
  adsr(g, t, a, d, v);
  s.connect(fl); fl.connect(g); g.connect(out);
  s.start(t, Math.random() * 0.5); s.stop(t + a + d + 0.05);
}
function marimba(f, t, v = 0.25, len = 0.55, out = sfxBus) {
  osc("sine", f, t, len, v, { a: 0.002, out });
  osc("sine", f * 4, t, len * 0.22, v * 0.35, { a: 0.001, out });
  osc("sine", f * 10, t, 0.035, v * 0.18, { a: 0.001, out });
  nz(t, 0.02, v * 0.45, { type: "highpass", f: 3000, out });
}
function bell(f, t, v = 0.15, d = 1.3, out = sfxBus) {
  const c = ctx.createOscillator(), m = ctx.createOscillator();
  const mg = ctx.createGain(), g = ctx.createGain();
  c.frequency.value = f; m.frequency.value = f * 3.5;
  mg.gain.setValueAtTime(f * 1.8, t); mg.gain.exponentialRampToValueAtTime(1, t + d * 0.6);
  m.connect(mg); mg.connect(c.frequency);
  adsr(g, t, 0.003, d, v);
  c.connect(g); g.connect(out);
  c.start(t); m.start(t); c.stop(t + d + 0.05); m.stop(t + d + 0.05);
}
function brass(f, t, d, v = 0.14) {
  osc("sawtooth", f, t, d, v, { a: 0.02, lp: 2400, det: -7 });
  osc("sawtooth", f, t, d, v, { a: 0.02, lp: 2400, det: 7 });
  osc("square", f / 2, t, d, v * 0.5, { a: 0.02, lp: 900 });
}
function stamp(t, v = 0.4) {
  osc("sine", 130, t, 0.45, v, { to: 45, a: 0.002 });
  nz(t, 0.09, v * 0.9, { type: "lowpass", f: 700, a: 0.001 });
}
function roll(t, dur, vol) {
  let x = 0, gap = 0.11;
  while (x < dur) {
    nz(t + x, 0.05, vol * (0.4 + (x / dur) * 0.9), { type: "highpass", f: 1800 });
    osc("sine", 190, t + x, 0.06, vol * 0.3, { to: 120 });
    x += gap; gap = Math.max(0.035, gap * 0.9);
  }
}
function applause(t, dur, vol) {
  for (let k = 0; k < dur * 60; k++) {
    const off = Math.random() * dur;
    const shape = Math.pow(Math.sin((Math.PI * off) / dur), 0.7);
    nz(t + off, 0.03 + Math.random() * 0.03, vol * shape * (0.4 + Math.random() * 0.6),
      { type: "bandpass", f: 1200 + Math.random() * 3500, q: 0.8 });
  }
}

const play = (fn) => (...a) => { if (!audio.ready || st.muted) return; try { fn(...a); } catch {} };

// ---------- the sound effects ----------
export const sfx = {
  click: play(() => { const t = now(); osc("sine", 1250, t, 0.05, 0.18, { to: 850 }); nz(t, 0.012, 0.1, { f: 2600, q: 3 }); }),
  hover: play(() => osc("sine", 2000, now(), 0.025, 0.02)),
  open: play(() => { const t = now(); nz(t, 0.18, 0.12, { f: 600, to: 3200, q: 0.8 }); marimba(nt(12), t + 0.08, 0.12, 0.3); }),
  close: play(() => { const t = now(); nz(t, 0.14, 0.1, { f: 3000, to: 500, q: 0.8 }); }),
  play: play(() => { const t = now(); nz(t, 0.35, 0.25, { f: 400, to: 5000, q: 0.7 }); stamp(t + 0.18, 0.35); bell(nt(19), t + 0.2, 0.1, 1); }),
  deny: play(() => { const t = now(); osc("square", 110, t, 0.14, 0.12, { lp: 600 }); osc("square", 98, t + 0.12, 0.18, 0.12, { lp: 600 }); }),
  join: play(() => { const t = now(); marimba(nt(7), t, 0.22); marimba(nt(12), t + 0.09, 0.22); }),
  leave: play(() => { const t = now(); marimba(nt(12), t, 0.16); marimba(nt(4), t + 0.1, 0.16, 0.5); }),
  save: play(() => { const t = now(); stamp(t, 0.35); bell(nt(19), t + 0.06, 0.12, 1.1); bell(nt(24), t + 0.16, 0.08, 1.2); }),
  allReady: play(() => {
    const t = now();
    [0, 4, 7, 12].forEach((s, i) => marimba(nt(s), t + i * 0.07, 0.22));
    [0, 7, 12, 16].forEach((s) => bell(nt(s + 12), t + 0.32, 0.08, 1.4));
  }),
  // big round title: riser, then a hit that lands exactly when the title slams in (0.8 s)
  intro: play(() => {
    const t = now();
    nz(t, 0.8, 0.28, { f: 200, to: 6000, q: 0.7, a: 0.5 });
    osc("sawtooth", 70, t, 0.8, 0.1, { to: 280, lp: 900, a: 0.5 });
    roll(t + 0.1, 0.65, 0.12);
    const h = t + 0.8;
    stamp(h, 0.5);
    [0, 7, 12].forEach((s) => brass(nt(s - 12), h, 0.45, 0.16));
    nz(h, 0.7, 0.16, { type: "highpass", f: 5000, a: 0.002 });
  }),
  deal: play((n = 3) => { const t = now(); for (let i = 0; i < n; i++) { nz(t + i * 0.13, 0.08, 0.2, { f: 2400, to: 7000, q: 1.5 }); osc("sine", 170, t + i * 0.13 + 0.05, 0.08, 0.14, { to: 90 }); } }),
  yourTurn: play(() => { const t = now(); bell(nt(19), t, 0.2, 1.1); bell(nt(24), t + 0.13, 0.16, 1.2); }),
  turn: play(() => osc("sine", 700, now(), 0.06, 0.07, { to: 640 })),
  react: play((v) => {
    const t = now();
    if (v === "yes") { marimba(nt(14), t, 0.2); marimba(nt(19), t + 0.07, 0.2); }
    else if (v === "no") { osc("triangle", 196, t, 0.2, 0.2, { to: 130, lp: 900 }); nz(t, 0.03, 0.1, { f: 900, q: 2 }); }
    else { marimba(nt(9), t, 0.16); marimba(nt(7), t + 0.1, 0.16); }
  }),
  guess: play(() => { const t = now(); roll(t, 1.0, 0.16); osc("sawtooth", 73, t, 1.1, 0.08, { lp: 300, a: 0.7 }); }),
  voteYes: play(() => { const t = now(); marimba(nt(12), t, 0.2); marimba(nt(16), t + 0.07, 0.2); }),
  voteNo: play(() => { const t = now(); osc("triangle", 175, t, 0.18, 0.2, { to: 120, lp: 800 }); osc("triangle", 147, t + 0.09, 0.2, 0.18, { to: 100, lp: 800 }); }),
  correct: play(() => {
    const t = now();
    [[12, 0, 0.16], [16, 0.1, 0.16], [19, 0.2, 0.16], [24, 0.32, 0.7]].forEach(([s, d, l]) => brass(nt(s), t + d, l, 0.15));
    [24, 28, 31].forEach((s, i) => bell(nt(s), t + 0.32 + i * 0.05, 0.09, 1.4));
    [0, 4, 7, 12, 16].forEach((s, i) => marimba(nt(s + 12), t + 0.1 + i * 0.06, 0.1, 0.4));
    nz(t + 0.32, 0.9, 0.16, { type: "highpass", f: 5000, a: 0.002 });
  }),
  wrong: play(() => { // sad trombone
    const t = now();
    [-6, 6].forEach((d) => {
      osc("sawtooth", 233, t, 0.38, 0.12, { to: 208, lp: 800, det: d, a: 0.03 });
      osc("sawtooth", 220, t + 0.42, 0.7, 0.12, { to: 138, lp: 700, det: d, a: 0.03 });
    });
  }),
  out: play(() => { const t = now(); osc("sine", 95, t, 0.7, 0.4, { to: 35 }); [7, 4, 0, -5].forEach((s, i) => marimba(nt(s), t + 0.15 + i * 0.16, 0.16, 0.6)); }),
  reveal: play(() => { const t = now(); nz(t, 0.4, 0.22, { f: 900, to: 6500, q: 0.9, a: 0.1 }); bell(nt(24), t + 0.3, 0.1, 1.2); }),
  roundEnd: play(() => { const t = now(); [0, 4, 7, 12].forEach((s) => marimba(nt(s), t, 0.14, 0.9)); bell(nt(19), t + 0.05, 0.1, 1.5); }),
  win: play(() => {
    const t = now();
    [[0, 0], [0, 0.14], [0, 0.28], [4, 0.42], [7, 0.64], [4, 0.86], [7, 1.04], [12, 1.3]]
      .forEach(([s, d]) => brass(nt(s + 12), t + d, d === 1.3 ? 1.1 : 0.2, 0.15));
    [12, 16, 19, 24].forEach((s) => bell(nt(s), t + 1.3, 0.1, 2));
    stamp(t + 1.3, 0.35);
    applause(t + 1.2, 3.2, 0.09);
  }),
};

// ---------- ambient music: a slow pad + sparse marimba notes ----------
const CH = [[-12, -5, 1, 4], [-15, -8, -3, 0], [-7, -3, 0, 4], [-5, 0, 2, 7]];
const PENT = [0, 2, 4, 7, 9, 12, 14, 16, 19];
const LEVEL = { menu: 0.06, lobby: 0.05, round: 0.028, results: 0.07 };
const GAPS = { menu: [2.5, 5], lobby: [3, 6], round: [6, 11], results: [2, 4] };

export const music = {
  mode: "off", pad: null, pluck: null, chordTimer: null, idx: 0,
  set(m) { this.mode = m; this.refresh(); },
  refresh() {
    if (!ctx || ctx.state !== "running") return;
    if (this.mode === "off" || !st.music) { this.stopAll(); return; }
    this.startPad();
    this.pad.gain.gain.setTargetAtTime(LEVEL[this.mode] || 0.04, now(), 0.8);
    this.schedulePluck();
  },
  startPad() {
    if (this.pad) return;
    const gain = ctx.createGain(); gain.gain.value = 0.0001;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 650;
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.09; lg.gain.value = 220; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
    const oscs = CH[0].map((s, i) => {
      const o = ctx.createOscillator(); o.type = i % 2 ? "triangle" : "sine";
      o.frequency.value = nt(s); o.detune.value = (i - 1.5) * 5; o.connect(lp); o.start(); return o;
    });
    lp.connect(gain); gain.connect(musicBus);
    this.pad = { gain, oscs, lfo, lp };
    this.chordTimer = setInterval(() => {
      if (!this.pad || !ctx) return;
      this.idx = (this.idx + 1) % CH.length;
      this.pad.oscs.forEach((o, i) => o.frequency.setTargetAtTime(nt(CH[this.idx][i]), now(), 1.4));
    }, 7000);
  },
  schedulePluck() {
    if (this.pluck) return;
    const go = () => {
      this.pluck = null;
      if (!ctx || this.mode === "off" || !st.music || ctx.state !== "running") return;
      const s = PENT[Math.floor(Math.random() * PENT.length)] + (Math.random() < 0.4 ? 12 : 0);
      try { marimba(nt(s), now(), (LEVEL[this.mode] || 0.04) * 1.4, 1.1, musicBus); } catch {}
      const [a, b] = GAPS[this.mode] || [3, 6];
      this.pluck = setTimeout(go, (a + Math.random() * (b - a)) * 1000);
    };
    this.pluck = setTimeout(go, 800);
  },
  stopAll() {
    if (this.pluck) { clearTimeout(this.pluck); this.pluck = null; }
    if (this.pad && ctx) {
      const p = this.pad; this.pad = null;
      clearInterval(this.chordTimer);
      p.gain.gain.setTargetAtTime(0.0001, now(), 0.2);
      setTimeout(() => { try { p.oscs.forEach((o) => o.stop()); p.lfo.stop(); } catch {} }, 900);
    }
  },
};
