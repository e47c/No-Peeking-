// Big banners and confetti
export function banner(text, sub = "", kind = "good") {
  const box = document.getElementById("fx");
  const el = document.createElement("div");
  el.className = `banner ${kind}`;
  const main = document.createElement("div");
  main.className = "banner-main";
  main.textContent = text;
  el.appendChild(main);
  if (sub) {
    const s = document.createElement("div");
    s.className = "banner-sub";
    s.textContent = sub;
    el.appendChild(s);
  }
  box.appendChild(el);
  setTimeout(() => el.remove(), 2700);
}

let raf = 0;
export function confetti(ms = 2500, count = 140) {
  const cv = document.getElementById("confetti");
  const c = cv.getContext("2d");
  cv.width = window.innerWidth;
  cv.height = window.innerHeight;
  const colors = ["#e8111c", "#c9a063", "#f4f0e8", "#ffd23f", "#ff7ad9", "#3fd0ff"];
  const parts = [];
  const spawn = (n) => {
    for (let i = 0; i < n; i++) {
      parts.push({
        x: Math.random() * cv.width, y: -20 - Math.random() * 120,
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
  const step = (now) => {
    c.clearRect(0, 0, cv.width, cv.height);
    if (now - start < ms * 0.6) spawn(3);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.r += p.vr;
      c.save(); c.translate(p.x, p.y); c.rotate(p.r);
      c.fillStyle = p.c; c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      c.restore();
    }
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i].y > cv.height + 30) parts.splice(i, 1);
    if (parts.length && now - start < ms + 3500) raf = requestAnimationFrame(step);
    else c.clearRect(0, 0, cv.width, cv.height);
  };
  raf = requestAnimationFrame(step);
}
