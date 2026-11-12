// Visual effects: round title card, call-out stamps, screen flashes, confetti
const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Letterbox "title card" between rounds. Timed with the intro sound (title slams in at ~0.8s).
let introTimer = 0;
export function intro(title, sub = "") {
  const o = document.getElementById("intro");
  clearTimeout(introTimer);
  o.replaceChildren();
  const top = document.createElement("div"); top.className = "bar top";
  const bot = document.createElement("div"); bot.className = "bar bot";
  const txt = document.createElement("div"); txt.className = "txt";
  const big = document.createElement("div"); big.className = "big"; big.textContent = title;
  const small = document.createElement("div"); small.className = "small"; small.textContent = sub;
  txt.append(big, small);
  o.append(top, bot, txt);
  o.className = "intro";
  void o.offsetWidth;
  o.classList.add("run");
  introTimer = setTimeout(() => { o.className = "intro"; o.replaceChildren(); }, 2700);
}

export function callout(text, sub = "", kind = "good") {
  const box = document.getElementById("fx");
  const el = document.createElement("div");
  el.className = `callout ${kind}`;
  const m = document.createElement("div"); m.className = "callout-main"; m.textContent = text;
  el.appendChild(m);
  if (sub) { const s = document.createElement("div"); s.className = "callout-sub"; s.textContent = sub; el.appendChild(s); }
  box.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

export function flash(kind) {
  const f = document.getElementById("flash");
  f.className = "flash " + kind;
  void f.offsetWidth;
  f.classList.add("go");
}

let raf = 0;
export function confetti(ms = 2500, count = 140) {
  if (reduce()) count = Math.min(count, 24);
  const cv = document.getElementById("confetti");
  const c = cv.getContext("2d");
  cv.width = window.innerWidth;
  cv.height = window.innerHeight;
  const colors = ["#ff4a2e", "#ffcf33", "#f4ead5", "#1fc6b4", "#34d27b", "#ff8bd0"];
  const parts = [];
  const spawn = (n) => {
    for (let i = 0; i < n; i++) {
      parts.push({
        x: Math.random() * cv.width, y: -20 - Math.random() * 140,
        vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 5,
        r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4,
        w: 6 + Math.random() * 8, h: 10 + Math.random() * 10,
        c: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  };
  spawn(count);
  const start = performance.now();
  cancelAnimationFrame(raf);
  const step = (t) => {
    c.clearRect(0, 0, cv.width, cv.height);
    if (t - start < ms * 0.6) spawn(reduce() ? 0 : 3);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.r += p.vr;
      c.save(); c.translate(p.x, p.y); c.rotate(p.r);
      c.fillStyle = p.c; c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      c.restore();
    }
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i].y > cv.height + 30) parts.splice(i, 1);
    if (parts.length && t - start < ms + 3500) raf = requestAnimationFrame(step);
    else c.clearRect(0, 0, cv.width, cv.height);
  };
  raf = requestAnimationFrame(step);
}
