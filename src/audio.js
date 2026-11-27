// ===== NO PEEKING! sound design =====
// Everything is synthesized (no files). Three ideas hold the set together:
//
//   1. One key. D major pentatonic, so any two sounds that overlap still agree.
//   2. One room. Every voice sends a little signal into the same short reverb, which is
//      what makes a pile of separate beeps sound like one instrument kit in one place.
//   3. A ceiling on brightness. Every noise voice runs through a lowpass, so nothing in
//      the game hisses. Harshness is the fastest way to make a sound annoying.
//
// Voices: mallet (marimba), glass (FM bell), horn (filtered brass), thump, swish, brush
// roll, shimmer and applause. Volume, music and mute are remembered per device.
const KEY = "np_audio_v2";
const st = { vol: 0.75, music: true, muted: false };
try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch {}
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };

let ctx = null, master = null, sfxBus = null, musicBus = null, musicIn = null;
let fxSend = null, duckGain = null, nbuf = null, rendering = false;
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

// White noise to filter into swishes, brushes and taps.
function noiseBuffer(c, secs) {
  const b = c.createBuffer(1, Math.floor(c.sampleRate * secs), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

// A small, dark room. Decaying noise, lowpassed by a one-pole as it is generated, with a
// short pre-delay so the direct sound still reads as the attack.
function roomImpulse(c, secs) {
  const len = Math.floor(c.sampleRate * secs);
  const pre = Math.floor(c.sampleRate * 0.012);
  const b = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const x = (i - pre) / (len - pre);
      lp += ((Math.random() * 2 - 1) - lp) * 0.22;
      d[i] = lp * Math.pow(1 - x, 2.6);
    }
  }
  return b;
}

function buildGraph(context) {
  ctx = context;
  master = ctx.createGain();
  sfxBus = ctx.createGain();
  musicBus = ctx.createGain();
  duckGain = ctx.createGain();   // music steps aside for the big moments
  fxSend = ctx.createGain();

  // Master chain: lose the rumble, glue the whole mix gently, then catch any peak so a
  // stack of sounds can never clip or jump out at somebody.
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass"; hp.frequency.value = 28;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -18; glue.knee.value = 24; glue.ratio.value = 2.4;
  glue.attack.value = 0.012; glue.release.value = 0.25;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = 0.001; limiter.release.value = 0.09;
  const ceiling = ctx.createGain(); ceiling.gain.value = 0.9;
  master.connect(hp); hp.connect(glue); glue.connect(limiter);
  limiter.connect(ceiling); ceiling.connect(ctx.destination);

  const verb = ctx.createConvolver();
  verb.buffer = roomImpulse(ctx, 1.5);
  const ret = ctx.createGain(); ret.gain.value = 0.5;
  fxSend.connect(verb); verb.connect(ret); ret.connect(master);

  sfxBus.connect(master);
  duckGain.connect(musicBus); musicBus.connect(master);
  musicIn = duckGain;
  // The music feeds the room from *after* its own on/off gain, so switching music off
  // or ducking it takes the reverb with it instead of leaving a tail behind.
  const mSend = ctx.createGain(); mSend.gain.value = 0.3;
  musicBus.connect(mSend); mSend.connect(fxSend);
  nbuf = noiseBuffer(ctx, 2);
}

// Pull the music down under a big sound and let it back up afterwards. Without this the
// pad and a fanfare fight each other and both lose.
function duck(level, hold) {
  if (!duckGain) return;
  const t = ctx.currentTime, g = duckGain.gain;
  g.cancelScheduledValues(t);
  g.setTargetAtTime(level, t, 0.05);
  g.setTargetAtTime(1, t + hold, 0.5);
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
        buildGraph(new AC());
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

// ---------- the channel strip ----------
// Every voice gets a place in the stereo field and a send into the shared room. Width is
// what stops a busy moment turning into a single blob in the middle.
function chan(out, pan, send) {
  const g = ctx.createGain();
  let n = g;
  if (pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p); n = p;
  }
  n.connect(out);
  // Music voices do not send individually - the music bus has one send of its own, so
  // that the reverb obeys the music switch.
  if (send > 0 && out !== musicIn) { const s = ctx.createGain(); s.gain.value = send; n.connect(s); s.connect(fxSend); }
  return g;
}

function env(g, t, a, d, peak, sus = 0) {
  const p = Math.max(peak, 0.0003);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(p, t + a);
  if (sus) g.gain.setValueAtTime(p, t + a + sus);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + sus + d);
  g.gain.setValueAtTime(0, t + a + sus + d + 0.004);
}

function tone(type, f, t, d, v, o = {}) {
  const { a = 0.005, to = 0, out = sfxBus, lp = 0, lpTo = 0, q = 0.7, det = 0, pan = 0, send = 0.12, sus = 0 } = o;
  const os = ctx.createOscillator();
  os.type = type;
  os.frequency.setValueAtTime(f, t);
  if (to) os.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + a + sus + d);
  if (det) os.detune.value = det;
  let n = os;
  if (lp) {
    const fl = ctx.createBiquadFilter();
    fl.type = "lowpass"; fl.Q.value = q;
    fl.frequency.setValueAtTime(lp, t);
    if (lpTo) fl.frequency.exponentialRampToValueAtTime(Math.max(lpTo, 60), t + a + sus + d);
    n.connect(fl); n = fl;
  }
  const g = ctx.createGain();
  env(g, t, a, d, v, sus);
  n.connect(g); g.connect(chan(out, pan, send));
  os.start(t); os.stop(t + a + sus + d + 0.08);
}

function nz(t, d, v, o = {}) {
  const { type = "bandpass", f = 1200, to = 0, q = 0.8, ceil = 8000, out = sfxBus, a = 0.006, pan = 0, send = 0.14, sus = 0 } = o;
  const s = ctx.createBufferSource();
  s.buffer = nbuf; s.loop = true;
  const fl = ctx.createBiquadFilter();
  fl.type = type; fl.Q.value = q;
  fl.frequency.setValueAtTime(f, t);
  if (to) fl.frequency.exponentialRampToValueAtTime(Math.max(to, 40), t + a + sus + d);
  // The ceiling every noise voice goes through. This is the single rule that keeps the
  // whole set from sounding hissy and tiring.
  const cap = ctx.createBiquadFilter();
  cap.type = "lowpass"; cap.frequency.value = ceil; cap.Q.value = 0.7;
  const g = ctx.createGain();
  env(g, t, a, d, v, sus);
  s.connect(fl); fl.connect(cap); cap.connect(g); g.connect(chan(out, pan, send));
  s.start(t, Math.random() * 1.2); s.stop(t + a + sus + d + 0.08);
}

// ---------- voices ----------
function mallet(f, t, v = 0.22, len = 0.5, out = sfxBus, pan = 0) {
  tone("sine", f, t, len, v, { a: 0.003, out, pan, send: 0.16 });
  tone("sine", f * 3.93, t, len * 0.3, v * 0.3, { a: 0.002, out, pan, send: 0.1 });
  tone("sine", f * 9.2, t, 0.05, v * 0.1, { a: 0.001, out, pan, send: 0.06 });
  nz(t, 0.016, v * 0.16, { f: 2400, q: 1.2, ceil: 5200, out, pan, send: 0.05 });
}

function glass(f, t, v = 0.13, d = 1.2, out = sfxBus, pan = 0) {
  const c = ctx.createOscillator(), m = ctx.createOscillator();
  const mg = ctx.createGain(), g = ctx.createGain();
  c.frequency.value = f; m.frequency.value = f * 2.01;
  mg.gain.setValueAtTime(f * 1.1, t);
  mg.gain.exponentialRampToValueAtTime(1, t + d * 0.45);
  m.connect(mg); mg.connect(c.frequency);
  const cap = ctx.createBiquadFilter();
  cap.type = "lowpass"; cap.frequency.value = 7200;
  env(g, t, 0.004, d, v);
  c.connect(cap); cap.connect(g); g.connect(chan(out, pan, 0.3));
  c.start(t); m.start(t); c.stop(t + d + 0.1); m.stop(t + d + 0.1);
}

// A horn, not a buzzsaw. The brightness lives in a filter envelope that opens as the note
// lands, which is what a real brass section does and what a bare sawtooth never does.
function horn(f, t, d, v = 0.13, pan = 0) {
  [-6, 7].forEach((det, i) => tone("sawtooth", f, t, d, v * 0.6, {
    a: 0.028, det, lp: 420, lpTo: 1700, q: 1.1, sus: d * 0.25,
    pan: pan + (i ? 0.16 : -0.16), send: 0.22,
  }));
  tone("sine", f / 2, t, d, v * 0.5, { a: 0.02, pan, send: 0.1 });
}

function thump(t, v = 0.36, f = 140, pan = 0) {
  tone("sine", f, t, 0.4, v, { to: 42, a: 0.003, pan, send: 0.08 });
  nz(t, 0.07, v * 0.6, { type: "lowpass", f: 620, ceil: 900, a: 0.001, pan, send: 0.05 });
}

function swish(t, d, v, up = true, pan = 0) {
  nz(t, d, v, { f: up ? 500 : 4200, to: up ? 4200 : 500, q: 0.7, ceil: 7000, a: d * 0.35, pan, send: 0.3 });
}

// A shimmer where a cymbal would go: band-limited, so it sparkles without stinging. It
// turns up in every big moment, so its ceiling sets the brightness of the whole game.
function shimmer(t, v = 0.09, d = 0.9, pan = 0) {
  nz(t, d, v, { f: 3400, q: 0.4, ceil: 7600, a: 0.004, pan, send: 0.4 });
  nz(t, d * 0.4, v * 0.5, { f: 5200, q: 0.5, ceil: 7600, a: 0.002, pan: -pan, send: 0.3 });
}

function sparkle(t, n, v, spread = 0.5) {
  for (let i = 0; i < n; i++) {
    const s = PENT[Math.floor(Math.random() * PENT.length)] + 24;
    mallet(nt(s), t + Math.random() * spread, v * (0.5 + Math.random() * 0.5), 0.35, sfxBus, Math.random() * 1.4 - 0.7);
  }
}

// A brush roll that tightens and grows, rather than a burst of hiss.
function roll(t, dur, vol) {
  let x = 0, gap = 0.1;
  while (x < dur) {
    const k = x / dur;
    nz(t + x, 0.045, vol * (0.35 + k * 0.85), { f: 1500, q: 1.1, ceil: 5200, pan: (Math.random() - 0.5) * 0.5, send: 0.18 });
    tone("sine", 170, t + x, 0.05, vol * 0.22, { to: 110, send: 0.05 });
    x += gap; gap = Math.max(0.032, gap * 0.9);
  }
}

function applause(t, dur, vol) {
  const n = Math.round(dur * 46);
  for (let k = 0; k < n; k++) {
    const off = Math.random() * dur;
    const shape = Math.pow(Math.sin((Math.PI * off) / dur), 0.7);
    nz(t + off, 0.025 + Math.random() * 0.03, vol * shape * (0.4 + Math.random() * 0.6),
      { f: 900 + Math.random() * 2200, q: 0.9, ceil: 5000, pan: (Math.random() - 0.5) * 1.6, send: 0.25 });
  }
}

// ---------- the sound effects ----------
// Little rotating variations so the sounds you hear most often never settle into a loop.
let clickI = 0, turnI = 0, tickI = 0;

const SFX = {
  // --- interface ---
  click: () => {
    const t = now(), f = [980, 1040, 920, 1100][clickI++ % 4];
    tone("sine", f, t, 0.045, 0.13, { to: f * 0.68, a: 0.002, send: 0.08 });
    nz(t, 0.014, 0.065, { f: 2100, q: 2.2, ceil: 4200, send: 0.06 });
  },
  hover: () => tone("sine", 1500, now(), 0.055, 0.05, { a: 0.007, send: 0.12 }),
  open: () => { const t = now(); swish(t, 0.2, 0.09, true); mallet(nt(12), t + 0.07, 0.11, 0.34); },
  close: () => { const t = now(); swish(t, 0.16, 0.08, false); mallet(nt(5), t + 0.04, 0.07, 0.24); },
  play: () => {
    const t = now();
    nz(t, 0.5, 0.14, { f: 320, to: 3400, q: 0.6, ceil: 7000, a: 0.3, send: 0.3 });
    thump(t + 0.34, 0.34);
    [0, 7, 12].forEach((s, i) => horn(nt(s), t + 0.34, 0.5, 0.1, (i - 1) * 0.25));
    glass(nt(19), t + 0.4, 0.08, 1.1);
    sparkle(t + 0.42, 4, 0.06, 0.5);
  },
  // Two soft knocks on a closed door. The old version was a square-wave buzz.
  deny: () => {
    const t = now();
    thump(t, 0.2, 120);
    tone("triangle", 150, t, 0.16, 0.1, { to: 138, lp: 700, a: 0.01, send: 0.1 });
    thump(t + 0.13, 0.17, 112);
    tone("triangle", 142, t + 0.13, 0.2, 0.09, { to: 126, lp: 650, a: 0.01, send: 0.1 });
  },
  join: () => {
    const t = now();
    mallet(nt(7), t, 0.2, 0.5, sfxBus, -0.12);
    mallet(nt(12), t + 0.085, 0.2, 0.6, sfxBus, 0.12);
    glass(nt(24), t + 0.1, 0.05, 0.9);
  },
  leave: () => {
    const t = now();
    mallet(nt(12), t, 0.15, 0.45, sfxBus, 0.12);
    mallet(nt(4), t + 0.1, 0.15, 0.7, sfxBus, -0.12);
  },
  save: () => {
    const t = now();
    nz(t, 0.09, 0.08, { f: 1600, q: 0.9, ceil: 5000, send: 0.12 });  // paper
    thump(t + 0.02, 0.3, 130);                                       // the stamp landing
    glass(nt(19), t + 0.07, 0.1, 1);
    glass(nt(24), t + 0.17, 0.06, 1.1);
  },
  allReady: () => {
    const t = now();
    [0, 4, 7, 12].forEach((s, i) => mallet(nt(s), t + i * 0.075, 0.2, 0.55, sfxBus, (i - 1.5) * 0.18));
    [0, 7, 12, 16].forEach((s, i) => glass(nt(s + 12), t + 0.34, 0.055, 1.5, sfxBus, (i - 1.5) * 0.2));
  },

  // --- the round ---
  // Riser, then a hit that lands exactly when the title slams in at 0.8 s. The timing is
  // shared with the title card animation in fx.js, so it must stay at 0.8.
  intro: () => {
    const t = now();
    duck(0.25, 2.4);
    nz(t, 0.8, 0.16, { f: 180, to: 5200, q: 0.6, ceil: 7500, a: 0.55, send: 0.35 });
    tone("sawtooth", 70, t, 0.8, 0.07, { to: 280, lp: 300, lpTo: 1100, a: 0.5, send: 0.2 });
    roll(t + 0.12, 0.62, 0.1);
    const h = t + 0.8;
    thump(h, 0.42, 150);
    [0, 7, 12].forEach((s, i) => horn(nt(s - 12), h, 0.5, 0.12, (i - 1) * 0.3));
    shimmer(h, 0.085, 1.1);
    sparkle(h + 0.1, 5, 0.05, 0.5);
  },
  deal: (n = 3) => {
    const t = now();
    for (let i = 0; i < n; i++) {
      const o = t + i * 0.125, p = (i % 2 ? 1 : -1) * 0.3;
      nz(o, 0.075, 0.15, { f: 1300, to: 3600, q: 0.9, ceil: 6000, a: 0.012, pan: p, send: 0.2 });
      tone("sine", 190, o + 0.045, 0.08, 0.12, { to: 105, pan: p, send: 0.08 });
    }
  },
  yourTurn: () => {
    const t = now();
    glass(nt(19), t, 0.14, 1.1, sfxBus, -0.1);
    glass(nt(24), t + 0.13, 0.11, 1.2, sfxBus, 0.1);
    sparkle(t + 0.2, 3, 0.05, 0.35);
  },
  turn: () => mallet(nt([12, 14, 16][turnI++ % 3]), now(), 0.1, 0.3),
  react: (v) => {
    const t = now();
    if (v === "yes") { mallet(nt(14), t, 0.17, 0.4, sfxBus, -0.1); mallet(nt(19), t + 0.07, 0.17, 0.5, sfxBus, 0.1); }
    else if (v === "no") {
      tone("triangle", 200, t, 0.22, 0.14, { to: 132, lp: 900, a: 0.008, send: 0.14 });
      nz(t, 0.03, 0.05, { f: 700, q: 1.6, ceil: 2600 });
    } else { mallet(nt(9), t, 0.14, 0.4); mallet(nt(7), t + 0.1, 0.14, 0.5); }
  },
  guess: () => {
    const t = now();
    duck(0.3, 1.2);
    tone("sawtooth", 73, t, 1.1, 0.1, { lp: 180, lpTo: 520, a: 0.7, send: 0.2 });
    roll(t, 1, 0.14);
    [0, 1, 2, 3].forEach((i) => tone("sine", 1400, t + i * 0.25, 0.04, 0.07, { send: 0.2, pan: i % 2 ? 0.3 : -0.3 }));
  },
  voteYes: () => { const t = now(); mallet(nt(12), t, 0.17, 0.4); mallet(nt(16), t + 0.07, 0.17, 0.5); },
  voteNo: () => {
    const t = now();
    tone("triangle", 180, t, 0.2, 0.15, { to: 126, lp: 800, a: 0.008, send: 0.14 });
    tone("triangle", 150, t + 0.09, 0.22, 0.12, { to: 104, lp: 750, a: 0.008, send: 0.14 });
  },
  correct: () => {
    const t = now();
    duck(0.3, 1.6);
    [[12, 0], [16, 0.09], [19, 0.18]].forEach(([s, d]) => horn(nt(s), t + d, 0.22, 0.17));
    // The chord it lands on is three notes at once, which is what makes it feel like an
    // arrival rather than one more note in the run.
    [24, 19, 16].forEach((s, i) => horn(nt(s), t + 0.3, 0.6, i ? 0.12 : 0.18, (i - 1) * 0.3));
    thump(t + 0.3, 0.26, 160);
    [19, 24, 28].forEach((s, i) => glass(nt(s), t + 0.3 + i * 0.05, 0.055, 1.5, sfxBus, (i - 1) * 0.3));
    [0, 4, 7, 12, 16].forEach((s, i) => mallet(nt(s + 12), t + 0.08 + i * 0.055, 0.09, 0.35, sfxBus, (i - 2) * 0.16));
    shimmer(t + 0.3, 0.07, 1);
    sparkle(t + 0.35, 5, 0.035, 0.6);
  },
  // Still a sad slide, but a smooth one. Filtered saws gliding down beat a buzz.
  wrong: () => {
    const t = now();
    [-7, 8].forEach((d) => {
      tone("sawtooth", 233, t, 0.4, 0.085, { to: 207, lp: 900, lpTo: 520, det: d, a: 0.035, send: 0.2 });
      tone("sawtooth", 220, t + 0.44, 0.75, 0.085, { to: 138, lp: 820, lpTo: 380, det: d, a: 0.035, send: 0.22 });
    });
    tone("sine", 110, t + 0.44, 0.7, 0.07, { to: 69, a: 0.03, send: 0.1 });
  },
  out: () => {
    const t = now();
    thump(t, 0.3, 105);
    tone("sine", 95, t, 0.7, 0.2, { to: 36, send: 0.12 });
    [7, 4, 0, -5].forEach((s, i) => mallet(nt(s), t + 0.16 + i * 0.16, 0.13, 0.6, sfxBus, (1 - i * 0.6) * 0.3));
  },
  reveal: () => {
    const t = now();
    swish(t, 0.36, 0.11, true);
    glass(nt(24), t + 0.28, 0.08, 1.2);
    sparkle(t + 0.3, 4, 0.05, 0.4);
  },
  drumroll: () => {
    const t = now();
    duck(0.25, 2.2);
    roll(t, 1.7, 0.2);
    tone("sawtooth", 65, t, 1.8, 0.1, { lp: 160, lpTo: 420, a: 1.2, send: 0.2 });
    nz(t + 1.42, 0.42, 0.11, { f: 300, to: 4200, q: 0.6, ceil: 7000, a: 0.3, send: 0.35 });
  },
  tick: () => {
    const t = now();
    nz(t, 0.02, 0.08, { f: [2600, 2900, 2400][tickI++ % 3], q: 3, ceil: 5200, send: 0.1 });
    tone("sine", 1500, t, 0.03, 0.055, { send: 0.08 });
  },
  thud: (rank = 1) => {
    const t = now();
    thump(t, 0.3, 150 - rank * 8);
    glass(nt(12 + ([12, 7, 0][rank - 1] || 0)), t + 0.05, 0.07, 1);
  },
  roundEnd: () => {
    const t = now();
    [0, 4, 7, 12].forEach((s, i) => mallet(nt(s), t, 0.11, 0.95, sfxBus, (i - 1.5) * 0.22));
    glass(nt(19), t + 0.05, 0.07, 1.6);
  },
  win: () => {
    const t = now();
    duck(0.18, 4.2);
    [[0, 0], [0, 0.14], [0, 0.28], [4, 0.42], [7, 0.64], [4, 0.86], [7, 1.04]]
      .forEach(([s, d]) => horn(nt(s + 12), t + d, 0.2, 0.16));
    horn(nt(24), t + 1.3, 1.1, 0.19);
    horn(nt(19), t + 1.3, 1.1, 0.13, -0.3);
    horn(nt(16), t + 1.3, 1.1, 0.13, 0.3);
    [12, 16, 19, 24].forEach((s, i) => glass(nt(s), t + 1.3, 0.09, 2.2, sfxBus, (i - 1.5) * 0.25));
    thump(t + 1.3, 0.34, 150);
    shimmer(t + 1.3, 0.12, 1.6);
    sparkle(t + 1.4, 10, 0.055, 1.4);
    applause(t + 1.25, 3.2, 0.07);
  },
};

// Rapid clicking used to stack identical sounds on top of each other. A short gate per
// effect keeps the feedback crisp instead of turning it into a machine gun.
const GATE = { click: 45, hover: 90, tick: 28, turn: 90, react: 70, deal: 120, voteYes: 70, voteNo: 70, thud: 60 };
const lastAt = new Map();

function gated(name, fn) {
  return (...a) => {
    if (rendering) { try { fn(...a); } catch {} return; }
    if (!audio.ready || st.muted) return;
    const g = GATE[name] || 0;
    if (g) {
      const t = ctx.currentTime * 1000;
      if (t - (lastAt.get(name) || -1e9) < g) return;
      lastAt.set(name, t);
    }
    try { fn(...a); } catch {}
  };
}

export const sfxNames = Object.keys(SFX);
export const sfx = Object.fromEntries(sfxNames.map((k) => [k, gated(k, SFX[k])]));

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
      o.frequency.value = nt(s); o.detune.value = (i - 1.5) * 5;
      // Spread the pad voices across the field so it sits behind the effects.
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (p) { p.pan.value = (i - 1.5) * 0.35; o.connect(p); p.connect(lp); } else o.connect(lp);
      o.start(); return o;
    });
    lp.connect(gain); gain.connect(musicIn);
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
      try { mallet(nt(s), now(), (LEVEL[this.mode] || 0.04) * 1.4, 1.1, musicIn, (Math.random() - 0.5) * 0.8); } catch {}
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

// ---------- measurement hook ----------
// Renders one effect through the real graph in an offline context and reports how loud,
// how long and how bright it is. Balance and harshness are the two things a listener
// notices first and the two things a screenshot cannot show, so they get measured
// instead. main.js only exposes this when the game is run with ?np_dev=, so it is not
// reachable in the Discord activity.
export async function measureSfx(name, seconds = 4, arg) {
  const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OC || !SFX[name]) return null;
  const keep = { ctx, master, sfxBus, musicBus, musicIn, fxSend, duckGain, nbuf };
  const keepVol = st.vol, keepMuted = st.muted;
  try {
    rendering = true;
    st.vol = 0.75; st.muted = false;  // the shipped defaults, so numbers are comparable
    buildGraph(new OC(2, Math.ceil(44100 * seconds), 44100));
    apply(true);
    SFX[name](arg);
    const buf = await ctx.startRendering();
    const sr = buf.sampleRate;
    const L = buf.getChannelData(0);
    const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;

    const win = Math.round(sr * 0.3);
    let peak = 0, sum = 0, hfSum = 0, last = 0, hp = 0, tail = 0;
    let winSum = 0, loudest = 0;
    for (let i = 0; i < L.length; i++) {
      const x = (L[i] + R[i]) / 2;
      const ax = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      if (ax > peak) peak = ax;
      if (ax > 0.002) tail = i;
      sum += x * x;
      // One-pole highpass near 6 kHz. The share of energy above it is a good stand-in
      // for "does this sting", which is what we actually care about.
      hp = 0.56 * (hp + x - last);
      last = x;
      hfSum += hp * hp;
      winSum += x * x;
      if (i >= win) { const y = (L[i - win] + R[i - win]) / 2; winSum -= y * y; }
      const w = Math.sqrt(winSum / Math.min(i + 1, win));
      if (w > loudest) loudest = w;
    }
    const activeLen = Math.max(1, tail + 1);
    let active = 0;
    for (let i = 0; i < activeLen; i++) { const x = (L[i] + R[i]) / 2; active += x * x; }
    return {
      name,
      peak,
      rms: Math.sqrt(sum / L.length),
      loudest,
      activeRms: Math.sqrt(active / activeLen),
      hfRatio: sum > 0 ? Math.sqrt(hfSum / sum) : 0,
      seconds: activeLen / sr,
    };
  } finally {
    rendering = false;
    st.vol = keepVol; st.muted = keepMuted;
    ctx = keep.ctx; master = keep.master; sfxBus = keep.sfxBus; musicBus = keep.musicBus;
    musicIn = keep.musicIn; fxSend = keep.fxSend; duckGain = keep.duckGain; nbuf = keep.nbuf;
  }
}
