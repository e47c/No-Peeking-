// Sound effects made with code (Web Audio). No sound files needed.
let ctx = null, master = null, muted = false;
try { muted = localStorage.getItem("hb_muted") === "1"; } catch {}

export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
  } catch {}
}
export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem("hb_muted", m ? "1" : "0"); } catch {}
}

function tone({ f = 440, to = null, d = 0.15, type = "sine", v = 0.25, t = 0, a = 0.005 }) {
  const now = ctx.currentTime + t;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, now);
  if (to) o.frequency.exponentialRampToValueAtTime(to, now + d);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(v, now + a);
  g.gain.exponentialRampToValueAtTime(0.0001, now + d);
  o.connect(g).connect(master);
  o.start(now);
  o.stop(now + d + 0.05);
}

function noise({ d = 0.2, v = 0.2, t = 0, f = 1000, to = null, q = 1, type = "bandpass" }) {
  const now = ctx.currentTime + t;
  const len = Math.max(1, Math.floor(ctx.sampleRate * d));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const flt = ctx.createBiquadFilter();
  flt.type = type;
  flt.Q.value = q;
  flt.frequency.setValueAtTime(f, now);
  if (to) flt.frequency.exponentialRampToValueAtTime(to, now + d);
  const g = ctx.createGain();
  g.gain.setValueAtTime(v, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + d);
  src.connect(flt).connect(g).connect(master);
  src.start(now);
}

const S = (fn) => (...args) => {
  if (!ctx || muted || ctx.state !== "running") return;
  try { fn(...args); } catch {}
};

export const sfx = {
  click: S(() => tone({ f: 620, to: 380, d: 0.06, type: "square", v: 0.1 })),
  save: S(() => { tone({ f: 660, d: 0.08, type: "triangle", v: 0.2 }); tone({ f: 990, d: 0.14, type: "triangle", v: 0.2, t: 0.07 }); }),
  join: S(() => { tone({ f: 523, d: 0.12, type: "triangle", v: 0.2 }); tone({ f: 784, d: 0.18, type: "triangle", v: 0.2, t: 0.09 }); }),
  leave: S(() => { tone({ f: 659, d: 0.12, type: "triangle", v: 0.18 }); tone({ f: 392, d: 0.2, type: "triangle", v: 0.18, t: 0.09 }); }),
  roundStart: S(() => {
    noise({ d: 0.45, v: 0.35, f: 300, to: 4000, q: 0.8 });
    tone({ f: 120, to: 45, d: 0.4, type: "sine", v: 0.5, t: 0.35 });
    noise({ d: 0.25, v: 0.3, t: 0.35, f: 1500, type: "lowpass" });
  }),
  deal: S(() => {
    for (let i = 0; i < 4; i++) noise({ d: 0.09, v: 0.22, t: i * 0.1, f: 2200, to: 6000, q: 1.5 });
    tone({ f: 160, to: 80, d: 0.12, type: "sine", v: 0.3, t: 0.4 });
  }),
  yourTurn: S(() => {
    tone({ f: 880, d: 0.55, type: "triangle", v: 0.3 });
    tone({ f: 1760, d: 0.4, type: "sine", v: 0.1 });
    tone({ f: 1318, d: 0.5, type: "triangle", v: 0.22, t: 0.12 });
  }),
  turn: S(() => tone({ f: 760, to: 700, d: 0.07, type: "sine", v: 0.1 })),
  guessStart: S(() => {
    for (let i = 0; i < 12; i++) noise({ d: 0.06, v: 0.1 + i * 0.02, t: i * 0.07, f: 300 + i * 50, q: 0.5, type: "lowpass" });
    tone({ f: 220, to: 880, d: 0.9, type: "sawtooth", v: 0.07 });
  }),
  voteYes: S(() => { tone({ f: 660, d: 0.08, type: "triangle", v: 0.25 }); tone({ f: 880, d: 0.12, type: "triangle", v: 0.25, t: 0.07 }); }),
  voteNo: S(() => { tone({ f: 330, d: 0.1, type: "square", v: 0.14 }); tone({ f: 220, d: 0.16, type: "square", v: 0.14, t: 0.08 }); }),
  correct: S(() => {
    [523, 659, 784, 1047].forEach((f, i) => tone({ f, d: 0.2, type: "triangle", v: 0.28, t: i * 0.09 }));
    [1047, 1319, 1568].forEach((f) => tone({ f, d: 0.7, type: "triangle", v: 0.2, t: 0.38 }));
    noise({ d: 0.6, v: 0.12, t: 0.38, f: 6000, type: "highpass" });
  }),
  wrong: S(() => {
    tone({ f: 170, to: 80, d: 0.5, type: "sawtooth", v: 0.28 });
    noise({ d: 0.3, v: 0.15, f: 400, type: "lowpass" });
  }),
  out: S(() => {
    [392, 349, 311, 262].forEach((f, i) => tone({ f, d: 0.28, type: "square", v: 0.15, t: i * 0.17 }));
  }),
  win: S(() => {
    const notes = [[523, 0], [523, 0.14], [523, 0.28], [659, 0.42], [784, 0.62], [659, 0.82], [784, 1.0], [1047, 1.25]];
    notes.forEach(([f, t]) => tone({ f, d: 0.28, type: "triangle", v: 0.3, t }));
    [523, 659, 784, 1047].forEach((f) => tone({ f, d: 1.2, type: "triangle", v: 0.18, t: 1.25 }));
    noise({ d: 1.2, v: 0.12, t: 1.25, f: 6000, type: "highpass" });
  }),
};
