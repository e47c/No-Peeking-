import { DiscordSDK } from "@discord/embedded-app-sdk";
import "./style.css";
import { audio, sfx, music } from "./audio.js";
import { confetti, intro, flash, callout } from "./fx.js";

const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const NS = "http://www.w3.org/2000/svg";
function icon(id, cls) {
  const s = document.createElementNS(NS, "svg");
  if (cls) s.setAttribute("class", cls);
  s.setAttribute("aria-hidden", "true");
  const u = document.createElementNS(NS, "use");
  u.setAttribute("href", "#" + id);
  s.appendChild(u);
  return s;
}
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const ACCENTS = ["#ff4a2e", "#ffcf33", "#1fc6b4", "#ff8bd0", "#7aa8ff", "#a5e05a", "#c79bff", "#ff9d3d"];

const A = {
  sdk: null, user: null, token: null, instanceId: null, myId: null,
  ws: null, joined: false, fatal: false, retry: 0, retryTimer: 0,
  cur: null, prev: null, lastEv: null, screen: "loading",
  imgCache: new Map(), roster: new Map(), tiles: new Map(),
  slots: [], pending: [], pendingName: [], sending: new Set(), slotsBuilt: false,
  dockSig: "", guessKey: "", guessActSig: "", resultsKey: "", armTimer: 0,
};

// ---------- helpers ----------
const send = (o) => { if (A.ws && A.ws.readyState === 1) A.ws.send(JSON.stringify(o)); };
const accent = (s, id) => ACCENTS[Math.max(0, s.players.findIndex((p) => p.id === id)) % ACCENTS.length];
const nameOf = (s, id) => (s.players.find((p) => p.id === id) || { name: "Someone" }).name;
const announce = (t) => { const a = $("announcer"); a.textContent = ""; setTimeout(() => { a.textContent = t; }, 40); };

let toastTimer = 0;
function toast(msg, kind = "") {
  const t = $("toast");
  t.textContent = msg; t.className = "toast " + kind; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
}

function setAvatar(box, p) {
  const key = (p.avatar || "") + "|" + (p.name || "")[0];
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.replaceChildren();
  if (p.avatar) {
    const img = document.createElement("img");
    img.alt = ""; img.src = `https://cdn.discordapp.com/avatars/${p.id}/${p.avatar}.png?size=256`;
    box.appendChild(img);
  } else box.textContent = (p.name || "?")[0].toUpperCase();
}
function avatarEl(p, size = "") { const a = el("div", "avatar " + size); setAvatar(a, p); return a; }

function openDlg(id) { const d = $(id); if (!d.open) { d.showModal(); sfx.open(); } }
function closeDlg(d) { if (!d.open) return; d.classList.add("closing"); sfx.close(); setTimeout(() => { d.close(); d.classList.remove("closing"); }, 160); }

function armConfirm(btn, label, action) {
  const base = btn.textContent;
  btn.onclick = () => {
    if (btn.classList.contains("armed")) { clearTimeout(A.armTimer); btn.classList.remove("armed"); btn.textContent = base; action(); return; }
    btn.classList.add("armed"); btn.textContent = label;
    A.armTimer = setTimeout(() => { btn.classList.remove("armed"); btn.textContent = base; }, 3000);
  };
}

// ---------- screens ----------
function showScreen(name) {
  if (A.screen === name) return;
  A.screen = name;
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  const n = $("screen-" + name);
  n.classList.remove("hidden", "enter"); void n.offsetWidth; n.classList.add("enter");
  document.body.dataset.screen = name;
  $("hud").classList.toggle("hidden", name === "loading");
  $("dock").classList.toggle("hidden", name !== "game");
  $("roundLights").classList.toggle("hidden", name !== "game");
  music.set({ menu: "menu", lobby: "lobby", game: "round", results: "results" }[name] || "off");
  window.scrollTo(0, 0);
}

// ---------- menu ----------
function initMascot() {
  if (reduceMotion) return;
  const pupils = [...$("mascot").querySelectorAll(".pupil")];
  window.addEventListener("pointermove", (e) => {
    if (A.screen !== "menu") return;
    const r = $("mascot").getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height * 0.45);
    const dist = Math.hypot(dx, dy) || 1, k = Math.min(1, dist / 260);
    pupils.forEach((p) => { p.style.transform = `translate(${(dx / dist) * 12 * k}px, ${(dy / dist) * 9 * k}px)`; });
  }, { passive: true });
}

function setMuteIcon() {
  const m = audio.state.muted;
  const b = $("muteBtn");
  b.replaceChildren(icon(m ? "i-mute" : "i-sound"));
  b.setAttribute("aria-pressed", String(m));
  b.setAttribute("aria-label", m ? "Unmute sound" : "Mute sound");
  $("muteChk").checked = m;
}

// ---------- uploads ----------
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error("Could not open that picture. Try a JPG or PNG."));
    const reader = new FileReader();
    reader.onerror = fail;
    reader.onload = () => {
      const img = new Image();
      img.onerror = fail;
      img.onload = () => {
        const scale = Math.min(1, 640 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * scale)); c.height = Math.max(1, Math.round(img.height * scale));
        const g = c.getContext("2d");
        g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function setMsg(i, text, kind = "") { const m = A.slots[i].msg; m.textContent = text; m.className = "msg " + kind; }
function busy(i, on) { A.slots[i].busy.classList.toggle("hidden", !on); }
function saveLabel(i) { const f = A.slots[i]; f.save.textContent = f.card.classList.contains("locked") ? "Update" : "Lock it in"; }

function buildSlots(count) {
  if (A.slotsBuilt) return;
  A.slotsBuilt = true;
  for (let i = 0; i < count; i++) {
    const card = el("article", "frame");
    card.appendChild(el("div", "ticket", `Round ${i + 1}`));
    const drop = el("label", "drop");
    const file = document.createElement("input");
    file.type = "file"; file.accept = "image/*"; file.className = "sr-only";
    file.setAttribute("aria-label", `Choose a picture for round ${i + 1}`);
    const img = document.createElement("img"); img.alt = ""; img.className = "hidden";
    const ph = el("div", "ph"); ph.append(icon("i-camera"), el("span", "", "Add a picture"), el("small", "", "tap or drop one here"));
    const bz = el("div", "busy hidden"); bz.appendChild(el("span", "spinner"));
    drop.append(file, img, ph, bz, el("div", "lockstamp", "Locked"));

    const name = document.createElement("input");
    name.type = "text"; name.className = "caption-in"; name.maxLength = 30; name.placeholder = "Who is it?";
    name.setAttribute("aria-label", `Character name for round ${i + 1}`);
    const save = el("button", "btn", "Lock it in"); save.type = "button";
    const msg = el("p", "msg"); msg.setAttribute("role", "status");
    card.append(drop, name, save, msg);
    $("slots").appendChild(card);
    A.slots[i] = { card, drop, file, img, ph, busy: bz, name, save, msg, timer: 0 };

    const handle = async (f) => {
      setMsg(i, "");
      if (!f) return;
      if (!f.type.startsWith("image/")) return setMsg(i, "That is not a picture.", "bad");
      busy(i, true);
      try {
        A.pending[i] = await resizeImage(f);
        img.src = A.pending[i]; img.classList.remove("hidden"); ph.classList.add("hidden"); card.classList.add("has-pic");
      } catch (e) { setMsg(i, e.message, "bad"); sfx.deny(); }
      busy(i, false);
    };
    file.onchange = () => handle(file.files[0]);
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); handle(e.dataTransfer.files[0]); });
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") save.click(); });

    save.onclick = () => {
      const n = name.value.trim();
      if (!A.pending[i] && !card.classList.contains("locked")) { sfx.deny(); return setMsg(i, "Pick a picture first.", "bad"); }
      if (!A.pending[i]) { sfx.deny(); return setMsg(i, "Choose the picture again to update this card.", "bad"); }
      if (!n) { sfx.deny(); name.focus(); return setMsg(i, "Write who it is.", "bad"); }
      if (!A.ws || A.ws.readyState !== 1) { sfx.deny(); return setMsg(i, "Not connected right now.", "bad"); }
      A.sending.add(i); A.pendingName[i] = n; save.disabled = true; save.textContent = "Sending…"; setMsg(i, "");
      send({ type: "upload", slot: i, name: n, image: A.pending[i] });
      clearTimeout(A.slots[i].timer);
      A.slots[i].timer = setTimeout(() => {
        if (!A.sending.has(i)) return;
        A.sending.delete(i); save.disabled = false; saveLabel(i); setMsg(i, "No answer from the server. Try again.", "bad"); sfx.deny();
      }, 8000);
    };
  }
}

function updateSlots(s) {
  s.you.slots.forEach((sl, i) => {
    const f = A.slots[i]; if (!f) return;
    f.card.classList.toggle("locked", sl.saved);
    if (sl.saved && !f.name.value) f.name.value = sl.name;
    if (!f.card.classList.contains("has-pic") && sl.saved) { f.ph.querySelector("span").textContent = "Picture locked in"; f.ph.querySelector("small").textContent = ""; }
    if (A.sending.has(i) && sl.saved && sl.name === A.pendingName[i]) {
      A.sending.delete(i); clearTimeout(f.timer); f.save.disabled = false;
      f.card.classList.remove("thud"); void f.card.offsetWidth; f.card.classList.add("thud");
      setMsg(i, "Locked in ✓", "ok"); sfx.save(); announce(`Card ${i + 1} locked in`);
    }
    if (!A.sending.has(i)) { f.save.disabled = false; saveLabel(i); }
  });
}

function resetSlots() {
  A.sending.clear();
  A.slots.forEach((f, i) => {
    clearTimeout(f.timer);
    A.pending[i] = null; A.pendingName[i] = "";
    f.file.value = ""; f.img.removeAttribute("src"); f.img.classList.add("hidden");
    f.ph.classList.remove("hidden"); f.ph.querySelector("span").textContent = "Add a picture"; f.ph.querySelector("small").textContent = "tap or drop one here";
    f.card.classList.remove("has-pic", "locked", "thud"); f.name.value = ""; f.save.disabled = false; f.save.textContent = "Lock it in"; setMsg(i, "");
  });
}

// ---------- lobby ----------
const isAllReady = (s) => s.players.length >= s.minPlayers && s.players.every((p) => p.uploaded >= s.cardsPerPlayer);

function renderLobby(s) {
  const ul = $("roster");
  const seen = new Set();
  s.players.forEach((p, i) => {
    let li = A.roster.get(p.id);
    if (!li) {
      li = el("li", "pass");
      li.append(el("div", "avatar lg"), el("div", "who"), el("div", "ready", "Ready"));
      const who = li.querySelector(".who");
      who.append(el("div", "pname"), el("div", "role"), el("div", "bulbs"));
      A.roster.set(p.id, li);
    }
    li.style.setProperty("--accent", accent(s, p.id));
    setAvatar(li.querySelector(".avatar"), p);
    li.querySelector(".pname").textContent = p.id === A.myId ? `${p.name} (you)` : p.name;
    const role = li.querySelector(".role");
    role.replaceChildren();
    if (p.id === s.hostId) { role.append(icon("i-crown"), document.createTextNode("HOST")); }
    const bulbs = li.querySelector(".bulbs");
    if (bulbs.children.length !== s.cardsPerPlayer) { bulbs.replaceChildren(); for (let k = 0; k < s.cardsPerPlayer; k++) bulbs.appendChild(el("i")); }
    [...bulbs.children].forEach((b, k) => b.classList.toggle("on", k < p.uploaded));
    li.classList.toggle("ready-on", p.uploaded >= s.cardsPerPlayer);
    li.classList.toggle("offline", !p.online);
    li.setAttribute("aria-label", `${p.name}, ${p.uploaded} of ${s.cardsPerPlayer} cards ready`);
    if (ul.children[i] !== li) ul.insertBefore(li, ul.children[i] || null);
    seen.add(p.id);
  });
  for (const [id, li] of A.roster) if (!seen.has(id)) { li.remove(); A.roster.delete(id); }
  $("castCount").textContent = String(s.players.length);

  const g = $("ghosts");
  g.replaceChildren();
  for (let k = s.players.length; k < s.minPlayers; k++) {
    const gp = el("div", "ghost-pass"); gp.append(el("i"), el("span", "", "Waiting for a challenger…")); g.appendChild(gp);
  }

  buildSlots(s.cardsPerPlayer);
  updateSlots(s);

  const isHost = s.hostId === A.myId, ready = isAllReady(s);
  const btn = $("startBtn");
  btn.classList.toggle("hidden", !isHost);
  btn.disabled = !ready;
  const hint = $("startHint");
  hint.classList.toggle("go", ready);
  if (s.players.length < s.minPlayers) hint.textContent = `Waiting for more players (need ${s.minPlayers}).`;
  else if (!ready) {
    const waiting = s.players.filter((p) => p.uploaded < s.cardsPerPlayer).map((p) => p.name);
    hint.textContent = `Waiting for ${waiting.slice(0, 3).join(", ")}${waiting.length > 3 ? " and others" : ""} to lock in all cards.`;
  } else hint.textContent = isHost ? "Everyone is ready. Raise the curtain!" : "Everyone is ready. Waiting for the host to start.";
}

// ---------- game table ----------
function buildTile() {
  const root = el("article", "polaroid");
  const peg = el("div", "peg");
  const av = el("div", "avatar sm"), who = el("div", "who"), nm = el("div", "pname"), sc = el("div", "pscore");
  who.append(nm, sc);
  const lives = el("div", "lives"); lives.setAttribute("role", "img");
  for (let i = 0; i < 3; i++) lives.appendChild(icon("i-eye", "life"));
  peg.append(av, who, lives);
  const photo = el("div", "photo");
  const img = document.createElement("img"); img.className = "hidden"; img.alt = "";
  const wait = el("div", "dealph hidden");
  const censor = el("div", "censor"); censor.append(icon("i-eye-closed"), el("span", "", "No peeking!"));
  const zoom = el("button", "zoombtn"); zoom.type = "button"; zoom.hidden = true;
  const stamp = el("div", "stamp");
  photo.append(img, wait, censor, zoom, stamp);
  const cap = el("div", "caption"), bubbles = el("div", "bubbles");
  root.append(peg, photo, cap, bubbles);
  return { root, av, nm, sc, lives, img, wait, zoom, stamp, cap, bubbles, c: {} };
}

function updateTile(t, p, s, idx) {
  const mine = p.id === A.myId;
  const cur = s.turn ? s.turn.currentId : null;
  const entry = s.table.find((x) => x.holderId === p.id);
  const src = entry ? A.imgCache.get(entry.key) : null;
  const r = t.root;
  r.style.setProperty("--accent", accent(s, p.id));
  r.style.setProperty("--i", idx);
  setAvatar(t.av, p);
  t.nm.textContent = (p.id === s.hostId ? "★ " : "") + (mine ? `${p.name} (you)` : p.name);
  const sc = `⭐ ${p.score}`;
  if (t.sc.textContent !== sc) { const had = t.sc.textContent !== ""; t.sc.textContent = sc; if (had) { t.sc.classList.remove("bump"); void t.sc.offsetWidth; t.sc.classList.add("bump"); } }
  [...t.lives.querySelectorAll("use")].forEach((u, i) => {
    const closed = i < p.wrong;
    u.setAttribute("href", closed ? "#i-eye-closed" : "#i-eye");
    u.parentNode.classList.toggle("closed", closed);
  });
  t.lives.setAttribute("aria-label", `${3 - p.wrong} of 3 lives left`);

  r.classList.toggle("mine", mine);
  r.classList.toggle("asking", p.id === cur && !s.roundDone);
  r.classList.toggle("solved", p.status === "solved");
  r.classList.toggle("out", p.status === "out");
  r.classList.toggle("offline", !p.online);
  t.stamp.textContent = p.status === "solved" ? `Got it +${p.lastPoints}` : p.status === "out" ? "Out" : "";

  if (t.c.src !== src) { t.c.src = src; if (src) t.img.src = src; }
  t.img.classList.toggle("hidden", !src);
  t.zoom.hidden = !src;
  t.wait.classList.toggle("hidden", !(!src && !mine));
  const censored = mine && !src;
  if (t.c.censored && !censored) { r.classList.add("revealed"); sfx.reveal(); announce("Your card is revealed"); }
  if (censored) r.classList.remove("revealed");
  t.c.censored = censored;
  t.cap.textContent = entry ? entry.name : mine ? "???" : "";
  if (entry && src) { t.img.alt = entry.name; t.zoom.setAttribute("aria-label", `Enlarge picture of ${entry.name}`); t.zoom.onclick = () => zoomIn(src, entry.name); }
}

function zoomIn(src, name) { $("zoomImg").src = src; $("zoomImg").alt = name; $("zoomCap").textContent = name; openDlg("dlgZoom"); }

function renderGame(s) {
  const table = $("table");
  const ordered = [...s.players].sort((a, b) => (a.id === A.myId ? -1 : b.id === A.myId ? 1 : 0));
  const seen = new Set();
  ordered.forEach((p, i) => {
    let t = A.tiles.get(p.id);
    if (!t) { t = buildTile(); A.tiles.set(p.id, t); }
    updateTile(t, p, s, i);
    if (table.children[i] !== t.root) table.insertBefore(t.root, table.children[i] || null);
    seen.add(p.id);
  });
  for (const [id, t] of A.tiles) if (!seen.has(id)) { t.root.remove(); A.tiles.delete(id); }

  const lights = $("roundLights");
  if (lights.children.length !== s.totalRounds) { lights.replaceChildren(); for (let i = 0; i < s.totalRounds; i++) lights.appendChild(el("i", "bulb")); }
  [...lights.children].forEach((b, i) => { b.classList.toggle("on", i < s.round); b.classList.toggle("now", i === s.round - 1); });
  lights.setAttribute("aria-label", `Round ${s.round} of ${s.totalRounds}`);
  renderDock(s);
}

function showBubble(playerId, kind) {
  const t = A.tiles.get(playerId);
  if (!t) return;
  const b = el("div", "bubble " + kind, kind === "yes" ? "YES!" : kind === "no" ? "NO!" : "MAYBE");
  t.bubbles.appendChild(b);
  setTimeout(() => b.remove(), 1800);
}

function renderDock(s) {
  const me = s.players.find((p) => p.id === A.myId);
  const isHost = s.hostId === A.myId;
  const cur = s.turn ? s.turn.currentId : null;
  const sig = [s.round, s.roundDone, cur, me && me.status, isHost, !!s.guess, s.players.length, s.round >= s.totalRounds].join("|");
  $("dock").classList.toggle("mine", cur === A.myId && !s.roundDone && !s.guess);
  if (sig === A.dockSig) return;
  A.dockSig = sig;
  const acts = $("dockActions"); acts.replaceChildren();
  const T = (t, sub) => { $("dockTitle").textContent = t; $("dockSub").textContent = sub || ""; };
  const btn = (label, cls, fn) => { const b = el("button", "btn " + cls, label); b.type = "button"; b.onclick = fn; acts.appendChild(b); return b; };

  if (s.guess) { T("Voting…", "Everyone is judging the guess."); }
  else if (s.roundDone) {
    T("Round complete!", isHost ? "Ready when you are." : "Waiting for the host to continue.");
    if (isHost) btn(s.round >= s.totalRounds ? "Final results" : "Next round", "primary", () => send({ type: "nextRound" }));
  } else if (cur === A.myId) {
    T("Your turn!", "Ask a yes/no question out loud. Got a “no”? Pass the turn. Sure about it? Guess!");
    btn("I know it!", "primary", () => send({ type: "guessStart" }));
    btn("Pass ▸", "ghost", () => send({ type: "pass" }));
  } else if (cur) {
    T(`${nameOf(s, cur)}'s turn`, "Answer their questions out loud, or tap a quick answer:");
    ["yes", "no", "maybe"].forEach((v) => btn(v === "maybe" ? "Maybe" : v, v === "yes" ? "good" : v === "no" ? "bad" : "", () => send({ type: "react", value: v })));
    if (isHost) btn("Skip turn", "ghost", () => send({ type: "pass" }));
  } else if (me && me.status === "solved") T("You got it!", `+${me.lastPoints} points. Watch the others.`);
  else if (me && me.status === "out") T("You are out", "Three wrong guesses. See you next round!");
  else T("Waiting…", "");
  if (isHost && !s.guess) {
    const b = btn("Back to lobby", "ghost small", () => {}); armConfirm(b, "Sure? Deletes pictures", () => send({ type: "reset" }));
  }
}

// ---------- guess stage ----------
function renderGuess(s) {
  const dlg = $("dlgGuess");
  if (!s.guess) {
    if (dlg.open && !dlg.classList.contains("closing")) { dlg.classList.add("closing"); setTimeout(() => { if (!A.cur || !A.cur.guess) dlg.close(); dlg.classList.remove("closing"); }, 180); }
    A.guessKey = ""; A.guessActSig = "";
    return;
  }
  const g = s.guess, gp = s.players.find((p) => p.id === g.guesserId), iAm = g.guesserId === A.myId;
  if (!dlg.open) dlg.showModal();
  if (A.guessKey !== g.guesserId) {
    A.guessKey = g.guesserId; A.guessActSig = "";
    const body = $("guessBody"); body.replaceChildren();
    const stage = el("div", "gstage");
    const left = el("div", "gphoto");
    const pol = el("article", "polaroid" + (iAm ? " mine" : ""));
    pol.style.setProperty("--accent", accent(s, gp.id));
    const photo = el("div", "photo");
    const entry = s.table.find((x) => x.holderId === g.guesserId), src = entry ? A.imgCache.get(entry.key) : null;
    if (!iAm && src) { const img = document.createElement("img"); img.alt = entry.name; img.src = src; photo.appendChild(img); }
    else { const c = el("div", "censor"); c.append(icon("i-eye-closed"), el("span", "", "No peeking!")); photo.appendChild(c); pol.classList.add("mine"); }
    pol.append(photo, el("div", "caption", iAm ? "???" : entry ? entry.name : ""));
    left.appendChild(pol);
    const info = el("div", "ginfo");
    info.style.setProperty("--accent", accent(s, gp.id));
    const h = el("h2", "gtitle", iAm ? "Your guess!" : `${gp.name} is guessing!`); h.id = "gTitle";
    info.append(avatarEl(gp, "xl"), h);
    if (iAm) {
      const eq = el("div", "eq"); eq.setAttribute("aria-hidden", "true"); for (let i = 0; i < 5; i++) eq.appendChild(el("i"));
      info.append(eq, el("p", "gsub", "Say your guess out loud in the voice call!"));
    } else {
      info.append(el("p", "gsub", "The real answer is:"), el("div", "gname", entry ? entry.name : "?"));
    }
    const dots = el("div", "dots"); dots.id = "gDots"; dots.setAttribute("role", "img");
    const vi = el("p", "gsub"); vi.id = "gVotes";
    const acts = el("div", "gactions"); acts.id = "gActs";
    info.append(dots, vi, acts);
    stage.append(left, info); body.appendChild(stage);
  }
  const dots = $("gDots"); dots.replaceChildren();
  for (let i = 0; i < g.needed; i++) dots.appendChild(el("i", i < g.yes ? "y" : i < g.yes + g.no ? "n" : ""));
  dots.setAttribute("aria-label", `${g.yes} yes, ${g.no} no, ${g.needed} voters`);
  $("gVotes").textContent = iAm ? `${g.yes + g.no} of ${g.needed} votes in. More than half must say yes.` : g.myVote === null ? "More than half must vote yes for it to count." : `You voted ${g.myVote ? "yes ✔" : "no ✖"}. Waiting for the others…`;
  const sig = `${iAm}|${g.myVote}`;
  if (sig !== A.guessActSig) {
    A.guessActSig = sig;
    const acts = $("gActs"); acts.replaceChildren();
    const b = (label, cls, fn, dis) => { const x = el("button", "btn " + cls, label); x.type = "button"; x.onclick = fn; x.disabled = !!dis; acts.appendChild(x); };
    if (iAm) b("Cancel guess", "ghost", () => send({ type: "guessCancel" }));
    else { b("Correct ✔", "good", () => send({ type: "vote", value: true }), g.myVote !== null); b("Wrong ✖", "bad", () => send({ type: "vote", value: false }), g.myVote !== null); }
  }
}

// ---------- results ----------
function renderResults(s) {
  const sorted = [...s.players].sort((a, b) => b.score - a.score);
  const key = JSON.stringify(sorted.map((p) => [p.id, p.score])) + s.hostId;
  if (key === A.resultsKey) return;
  A.resultsKey = key;
  const top = sorted[0] ? sorted[0].score : 0;
  const winners = top > 0 ? sorted.filter((p) => p.score === top) : [];
  $("winnerLine").textContent = winners.length ? `${winners.map((p) => p.name).join(" & ")} ${winners.length > 1 ? "take" : "takes"} the spotlight!` : "Nobody scored. Rematch?";
  const pod = $("podium"); pod.replaceChildren();
  [1, 0, 2].filter((i) => sorted[i]).forEach((i) => {
    const p = sorted[i];
    const d = el("div", `pod p${i + 1}`); d.style.setProperty("--accent", accent(s, p.id));
    if (winners.includes(p)) d.appendChild(icon("i-crown", "crown"));
    const step = el("div", "step"); step.append(el("div", "rank", String(i + 1)), el("div", "pts", `⭐ ${p.score}`));
    d.append(avatarEl(p, "lg"), el("div", "pname", p.name), el("div", "hist", p.hist.map((h, r) => `R${r + 1}: ${h ? "+" + h : "–"}`).join("  ")), step);
    pod.appendChild(d);
  });
  const ol = $("standings"); ol.replaceChildren();
  sorted.slice(3).forEach((p, i) => {
    const li = el("li"); li.style.setProperty("--accent", accent(s, p.id));
    const chips = el("div", "chips"); p.hist.forEach((h, r) => chips.appendChild(el("b", "", `R${r + 1} ${h ? "+" + h : "–"}`)));
    li.append(el("span", "pos", String(i + 4)), el("span", "nm", p.name), chips, el("span", "tot", `⭐ ${p.score}`));
    ol.appendChild(li);
  });
  const ra = $("resultActions"); ra.replaceChildren();
  if (s.hostId === A.myId) { const b = el("button", "btn primary huge", "Play again"); b.type = "button"; b.onclick = () => send({ type: "reset" }); ra.appendChild(b); ra.appendChild(el("p", "menu-note", "Back to the lobby. Everyone uploads 3 new cards.")); }
  else ra.appendChild(el("p", "menu-note", "Waiting for the host to start another game…"));
}

// ---------- sounds and animations from game events ----------
function playEvent(e, s) {
  const name = e.playerId ? nameOf(s, e.playerId) : "";
  const mine = e.playerId === A.myId;
  if (e.type === "roundStart") {
    intro(`Round ${s.round}`, mine ? "You ask first!" : `${name} asks first`);
    sfx.intro();
    announce(`Round ${s.round}. ${mine ? "You ask first" : name + " asks first"}.`);
    const n = s.players.length, table = $("table");
    table.classList.add("dealing");
    setTimeout(() => sfx.deal(n), 1850);
    setTimeout(() => table.classList.remove("dealing"), 1850 + n * 130 + 1000);
    if (mine) setTimeout(() => sfx.yourTurn(), 2800);
  } else if (e.type === "turn") {
    if (mine) { sfx.yourTurn(); announce("It is your turn"); } else { sfx.turn(); announce(`${name}'s turn`); }
  } else if (e.type === "react") {
    showBubble(e.to, e.value); sfx.react(e.value);
  } else if (e.type === "correct") {
    sfx.correct(); flash("good"); confetti(2200, 110); callout("Got it!", `${name}  +${e.points}`, "good"); announce(`${name} guessed right and scored ${e.points}`);
  } else if (e.type === "wrong") {
    sfx.wrong(); flash("bad"); callout("Nope!", `${name}  ${e.wrong}/3`, "bad"); announce(`${name} guessed wrong`);
    const t = A.tiles.get(e.playerId); if (t && !reduceMotion) { t.root.classList.remove("shake"); void t.root.offsetWidth; t.root.classList.add("shake"); setTimeout(() => t.root.classList.remove("shake"), 500); }
  } else if (e.type === "out") {
    setTimeout(() => sfx.out(), 500); announce(`${name} is out for this round`);
  } else if (e.type === "gameEnd") {
    sfx.win(); confetti(6000, 260);
    setTimeout(() => callout(`${(e.winnerIds || []).map((id) => nameOf(s, id)).join(" & ")} wins!`, "", "good"), 400);
    announce("Game over");
  }
}

function handleEffects(s) {
  const p = A.prev;
  if (p) {
    if (s.phase === "LOBBY" && p.phase === "LOBBY") {
      if (s.players.length > p.players.length) sfx.join(); else if (s.players.length < p.players.length) sfx.leave();
      if (isAllReady(s) && !isAllReady(p)) sfx.allReady();
    }
    if (s.guess && !p.guess) sfx.guess();
    if (s.guess && p.guess && s.guess.yes + s.guess.no > p.guess.yes + p.guess.no) { if (s.guess.yes > p.guess.yes) sfx.voteYes(); else sfx.voteNo(); }
    if (s.roundDone && !p.roundDone) sfx.roundEnd();
  }
  const maxId = s.events.reduce((m, e) => Math.max(m, e.id), 0);
  if (A.lastEv === null) { A.lastEv = maxId; return; } // never replay old events
  for (const e of s.events) if (e.id > A.lastEv) { A.lastEv = e.id; playEvent(e, s); }
}

// ---------- state from the server ----------
function onState(s) {
  A.joined = true; A.retry = 0; A.fatal = false;
  $("net").classList.add("hidden");
  A.cur = s;
  for (const t of s.table) if (t.image) A.imgCache.set(t.key, t.image);
  const keys = new Set(s.table.map((t) => t.key));
  for (const k of [...A.imgCache.keys()]) if (!keys.has(k)) A.imgCache.delete(k);

  const screen = s.phase === "LOBBY" ? "lobby" : s.phase === "ROUND" ? "game" : "results";
  showScreen(screen);
  if (screen === "lobby") { if (A.prev && A.prev.phase !== "LOBBY") resetSlots(); renderLobby(s); }
  if (screen === "game") renderGame(s);
  if (screen === "results") renderResults(s);
  if (screen !== "results") A.resultsKey = "";
  renderGuess(s);
  handleEffects(s);
  A.prev = s;
}

// ---------- connection (with automatic reconnect) ----------
function connect() {
  clearTimeout(A.retryTimer);
  const proto = location.protocol === "https:" ? "wss" : "ws";
  let ws;
  try { ws = new WebSocket(`${proto}://${location.host}/.proxy/ws`); } catch { return scheduleRetry(); }
  A.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: "hello", instanceId: A.instanceId, accessToken: A.token }));
  ws.onmessage = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === "state") onState(msg);
    else if (msg.type === "error") onServerError(msg.message);
  };
  ws.onclose = () => { if (A.ws !== ws) return; if (A.fatal) return; scheduleRetry(); };
  ws.onerror = () => {};
}

function onServerError(message) {
  sfx.deny();
  if (!A.joined) { // could not get in (for example a game is already running)
    A.fatal = true;
    if (A.ws) A.ws.close();
    $("playBtn").disabled = false; $("playBtn").textContent = "Play";
    toast(message || "Could not join.", "bad");
    return;
  }
  // an upload problem is shown on the card it belongs to
  const i = [...A.sending][0];
  if (i !== undefined) { A.sending.delete(i); clearTimeout(A.slots[i].timer); A.slots[i].save.disabled = false; saveLabel(i); setMsg(i, message, "bad"); }
  else toast(message, "bad");
}

function scheduleRetry() {
  A.retry += 1;
  const net = $("net");
  net.classList.remove("hidden");
  $("netMsg").textContent = A.joined ? `Connection lost. Reconnecting… (${A.retry})` : "Connecting…";
  $("netBtn").classList.toggle("hidden", A.retry < 4);
  if (!A.joined && A.retry >= 3) {
    net.classList.add("hidden"); $("playBtn").disabled = false; $("playBtn").textContent = "Play";
    toast("Could not reach the game server. Try again in a moment.", "bad"); A.retry = 0; return;
  }
  A.retryTimer = setTimeout(connect, Math.min(8000, 800 * 2 ** Math.min(A.retry, 4)));
}

function joinLobby() {
  $("playBtn").disabled = true; $("playBtn").textContent = "Joining…";
  sfx.play(); A.fatal = false; A.retry = 0; connect();
}

// ---------- start-up ----------
function bindUI() {
  document.addEventListener("pointerdown", (e) => {
    audio.unlock();
    const b = e.target.closest("button");
    if (b && !b.disabled && b.dataset.sfx !== "none") sfx.click();
  });
  document.addEventListener("keydown", () => audio.unlock(), { once: true });
  let last = null;
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const b = e.target.closest("button:not(:disabled), .drop");
    if (b && b !== last) { last = b; sfx.hover(); } else if (!b) last = null;
  });
  document.querySelectorAll("[data-close]").forEach((b) => { b.onclick = () => closeDlg(b.closest("dialog")); });
  document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d && d.id !== "dlgGuess") closeDlg(d); }));
  $("dlgGuess").addEventListener("cancel", (e) => e.preventDefault()); // cannot be skipped with Esc
  $("howBtn").onclick = $("hudHow").onclick = () => openDlg("dlgHow");
  $("setBtn").onclick = $("hudSet").onclick = () => openDlg("dlgSettings");
  $("playBtn").onclick = joinLobby;
  $("startBtn").onclick = () => send({ type: "start" });
  $("netBtn").onclick = () => { A.retry = 0; connect(); };
  $("retryBtn").onclick = () => location.reload();

  const st = audio.state;
  $("volRange").value = Math.round(st.vol * 100); $("musicChk").checked = st.music;
  $("volRange").oninput = (e) => audio.setVolume(e.target.value / 100);
  $("volRange").onchange = () => sfx.click();
  $("musicChk").onchange = (e) => audio.setMusic(e.target.checked);
  $("muteChk").onchange = (e) => { audio.setMuted(e.target.checked); setMuteIcon(); };
  $("muteBtn").onclick = () => { audio.setMuted(!audio.state.muted); setMuteIcon(); };
  setMuteIcon();
  initMascot();
}

async function start() {
  bindUI();
  document.body.dataset.screen = "loading";
  try {
    const sdk = new DiscordSDK(__CLIENT_ID__);
    A.sdk = sdk;
    await sdk.ready();
    const { code } = await sdk.commands.authorize({ client_id: __CLIENT_ID__, response_type: "code", state: "", prompt: "none", scope: ["identify"] });
    const res = await fetch("/.proxy/api/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    const { access_token } = await res.json();
    if (!access_token) throw new Error("The game server did not accept the login. Please try again.");
    A.token = access_token;
    const auth = await sdk.commands.authenticate({ access_token });
    A.user = auth.user; A.myId = auth.user.id; A.instanceId = sdk.instanceId;

    try {
      const info = await (await fetch("/.proxy/api/info")).json();
      if (info.publicUrl) {
        const base = info.publicUrl.replace(/\/$/, "");
        const link = (id, path) => { $(id).onclick = (e) => { e.preventDefault(); sdk.commands.openExternalLink({ url: base + path }); }; };
        link("termsLink", "/legal/terms.html"); link("privacyLink", "/legal/privacy.html");
        $("legal").classList.remove("hidden");
      }
    } catch {}

    const chip = $("whoChip");
    chip.replaceChildren(avatarEl({ id: auth.user.id, avatar: auth.user.avatar, name: auth.user.global_name || auth.user.username }, "sm"),
      el("span", "", `Playing as ${auth.user.global_name || auth.user.username}`));
    chip.classList.remove("hidden");
    $("playBtn").disabled = false;
    showScreen("menu");
    $("playBtn").focus({ preventScroll: true });
  } catch (err) {
    $("loadMsg").textContent = "The stage is stuck.";
    $("loadErr").textContent = String(err && err.message ? err.message : JSON.stringify(err));
    $("retryBtn").classList.remove("hidden");
    document.querySelector(".blink").style.animation = "none";
  }
}

start();
