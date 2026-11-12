import { DiscordSDK } from "@discord/embedded-app-sdk";
import { sfx, unlock, isMuted, setMuted } from "./sfx.js";
import { banner, confetti } from "./fx.js";

const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const ACCENTS = ["#e8111c", "#c9a063", "#3fd0ff", "#7dffa0", "#ff7ad9", "#ffd23f", "#9b7bff", "#ff8a3d"];

let ws = null;
let myId = null;
let prev = null;            // previous state (to know what changed)
let lastEventId = null;     // last event we already played
let slotsBuilt = false;
const pending = [];         // resized images waiting to be saved
const slotEls = [];
const imgCache = new Map(); // card key -> image data (only kept for the current round)

const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const showError = (t) => { $("error").textContent = t || ""; };
const accent = (s, p) => ACCENTS[Math.max(0, s.players.findIndex((x) => x.id === p.id)) % ACCENTS.length];
const nameOf = (s, id) => (s.players.find((p) => p.id === id) || { name: "Someone" }).name;

// ---------- small building blocks ----------
function avatar(p, size = "") {
  const a = el("div", "avatar " + size);
  if (p.avatar) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = `https://cdn.discordapp.com/avatars/${p.id}/${p.avatar}.png?size=256`;
    a.appendChild(img);
  } else a.textContent = (p.name || "?")[0].toUpperCase();
  return a;
}

function pips(n, on, cls = "") {
  const box = el("div", "pips " + cls);
  for (let i = 0; i < n; i++) box.appendChild(el("span", `pip ${cls.includes("strike") ? "strike " : ""}${i < on ? "on" : ""}`));
  return box;
}

function zoom(src, name) {
  const lb = $("lightbox");
  lb.querySelector("img").src = src;
  lb.querySelector("div").textContent = name || "";
  lb.classList.remove("hidden");
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file is not an image."));
      img.onload = () => {
        const scale = Math.min(1, 700 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        const g = c.getContext("2d");
        g.fillStyle = "#000";
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------- lobby ----------
function buildSlots(count) {
  if (slotsBuilt) return;
  slotsBuilt = true;
  for (let i = 0; i < count; i++) {
    const card = el("div", "slotcard");
    card.appendChild(el("div", "slot-head", `ROUND ${i + 1}`));

    const drop = el("label", "drop");
    const file = document.createElement("input");
    file.type = "file";
    file.accept = "image/*";
    const preview = document.createElement("img");
    preview.alt = "";
    preview.className = "hidden";
    const ph = el("div", "ph", "＋ ADD IMAGE");
    drop.append(file, preview, ph);

    const handle = async (f) => {
      showError("");
      if (!f) return;
      try {
        pending[i] = await resizeImage(f);
        preview.src = pending[i];
        preview.classList.remove("hidden");
        ph.classList.add("hidden");
      } catch (e) { showError(e.message); }
    };
    file.onchange = () => handle(file.files[0]);
    drop.ondragover = (e) => e.preventDefault();
    drop.ondrop = (e) => { e.preventDefault(); handle(e.dataTransfer.files[0]); };

    const name = document.createElement("input");
    name.type = "text";
    name.placeholder = "Character name";
    name.maxLength = 30;

    const save = el("button", "gold", "Save card");
    save.onclick = () => {
      showError("");
      if (!pending[i]) return showError(`Round ${i + 1}: choose an image first.`);
      if (!name.value.trim()) return showError(`Round ${i + 1}: type the character name.`);
      send({ type: "upload", slot: i, name: name.value, image: pending[i] });
    };

    const saved = el("span", "saved");
    card.append(drop, name, save, saved);
    $("slots").appendChild(card);
    slotEls[i] = { card, name, saved };
  }
}

function renderLobby(s) {
  const box = $("players");
  box.replaceChildren();
  s.players.forEach((p) => {
    const c = el("div", "profile" + (p.online ? "" : " offline"));
    c.style.setProperty("--accent", accent(s, p));
    if (p.id === s.hostId) c.appendChild(el("div", "crown", "👑 HOST"));
    const av = avatar(p, "lg");
    c.append(av, el("div", "pname", p.name), pips(s.cardsPerPlayer, p.uploaded));
    const ready = p.uploaded >= s.cardsPerPlayer;
    c.appendChild(el("div", "pstat" + (ready ? " ready" : ""), ready ? "READY ✓" : `${p.uploaded}/${s.cardsPerPlayer} CARDS`));
    box.appendChild(c);
  });

  buildSlots(s.cardsPerPlayer);
  s.you.slots.forEach((sl, i) => {
    slotEls[i].saved.textContent = sl.saved ? `✓ SAVED: ${sl.name}` : "";
    slotEls[i].card.classList.toggle("done", sl.saved);
    if (sl.saved && !slotEls[i].name.value) slotEls[i].name.value = sl.name;
  });

  const isHost = s.hostId === myId;
  const allReady = s.players.length >= s.minPlayers && s.players.every((p) => p.uploaded >= s.cardsPerPlayer);
  const btn = $("startBtn");
  btn.classList.toggle("hidden", !isHost);
  btn.disabled = !allReady;
  if (s.players.length < s.minPlayers) $("hint").textContent = `Waiting for more players (need ${s.minPlayers}).`;
  else if (!allReady) $("hint").textContent = `Everyone must save all ${s.cardsPerPlayer} cards before starting.`;
  else $("hint").textContent = isHost ? "Everyone is ready. Press Start!" : "Everyone is ready. Waiting for the host (👑) to start.";
}

// ---------- round ----------
function renderTurnBar(s) {
  const bar = $("turnBar");
  bar.replaceChildren();
  const isHost = s.hostId === myId;
  const me = s.players.find((p) => p.id === myId);
  const cur = s.turn ? s.turn.currentId : null;
  bar.className = "turnbar";

  const text = el("div", "tb-text");
  const actions = el("div", "tb-actions");

  if (s.roundDone) {
    bar.classList.add("done");
    text.append(el("div", "tb-title", "🏁 Round complete!"), el("div", "tb-sub", "Everyone finished." + (isHost ? " Press Next round." : " Waiting for the host.")));
  } else if (cur === myId) {
    bar.classList.add("mine");
    text.append(el("div", "tb-title", "🎯 Your turn!"), el("div", "tb-sub", "Ask a yes/no question out loud. When you hear “no”, pass the turn. Think you know it? Guess!"));
    const pass = el("button", "dark", "Pass turn ➜");
    pass.onclick = () => send({ type: "pass" });
    const guess = el("button", "gold big", "🎤 I'm guessing now");
    guess.onclick = () => send({ type: "guessStart" });
    actions.append(guess, pass);
  } else if (cur) {
    text.append(el("div", "tb-title", `🎯 ${nameOf(s, cur)}'s turn`), el("div", "tb-sub", "Answer their yes/no questions out loud."));
    if (isHost) {
      const skip = el("button", "dark", "Skip turn");
      skip.onclick = () => send({ type: "pass" });
      actions.append(skip);
    }
  } else if (me && me.status === "solved") {
    bar.classList.add("done");
    text.append(el("div", "tb-title", "✅ You got it!"), el("div", "tb-sub", `+${me.lastPoints} points. Watch the others.`));
  } else if (me && me.status === "out") {
    text.append(el("div", "tb-title", "💀 You are out"), el("div", "tb-sub", "3 wrong guesses. See you next round!"));
  } else {
    text.append(el("div", "tb-title", "Waiting..."));
  }
  bar.append(text, actions);
}

function renderTable(s) {
  const box = $("table");
  box.replaceChildren();
  const cur = s.turn ? s.turn.currentId : null;

  for (const p of s.players) {
    const t = s.table.find((x) => x.holderId === p.id);
    const src = t ? imgCache.get(t.key) : null;

    let cls = "tile";
    if (p.id === myId) cls += " me";
    if (p.id === cur && !s.roundDone) cls += " asking";
    if (p.status === "solved") cls += " solved";
    if (p.status === "out") cls += " out";
    if (!p.online) cls += " offline";
    const tile = el("div", cls);
    tile.style.setProperty("--accent", accent(s, p));

    const top = el("div", "tile-top");
    const info = el("div");
    info.append(el("div", "tile-name", (p.id === s.hostId ? "👑 " : "") + (p.id === myId ? `${p.name} (you)` : p.name)), el("div", "tile-score", `⭐ ${p.score}`));
    top.append(avatar(p, "sm"), info);

    const pic = el("div", "pic");
    const cname = el("div", "cname");
    if (t && src) {
      const img = document.createElement("img");
      img.alt = t.name;
      img.src = src;
      img.onclick = () => zoom(src, t.name);
      pic.append(img, el("div", "zoomhint", "tap to zoom"));
      cname.textContent = t.name;
    } else {
      pic.classList.add("mystery");
      pic.textContent = "?";
      cname.textContent = p.id === myId ? "Who are you?" : "";
    }

    const foot = el("div", "tile-foot");
    foot.appendChild(pips(3, p.wrong, "strike inline"));
    let st = "WAITING", stCls = "state";
    if (p.status === "solved") { st = `✅ +${p.lastPoints}`; stCls += " solved"; }
    else if (p.status === "out") { st = "💀 OUT"; stCls += " out"; }
    else if (!p.online) st = "OFFLINE";
    else if (p.id === cur && !s.roundDone) { st = "🎯 ASKING"; stCls += " asking"; }
    foot.appendChild(el("div", stCls, st));

    tile.append(top, pic, cname, foot);
    box.appendChild(tile);
  }
}

function renderGuess(s) {
  const ov = $("guessStage");
  ov.replaceChildren();
  if (!s.guess) { ov.classList.add("hidden"); return; }
  ov.classList.remove("hidden");

  const g = s.guess;
  const gp = s.players.find((p) => p.id === g.guesserId);
  const iAm = g.guesserId === myId;
  const t = s.table.find((x) => x.holderId === g.guesserId);
  const src = t ? imgCache.get(t.key) : null;

  const card = el("div", "gcard");
  card.style.setProperty("--accent", accent(s, gp));

  const left = el("div", "gleft");
  const pic = el("div", "pic");
  if (!iAm && src) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = src;
    pic.appendChild(img);
  } else {
    pic.classList.add("mystery");
    pic.textContent = "?";
  }
  left.appendChild(pic);

  const right = el("div", "gright");
  right.append(avatar(gp, "xl"), el("div", "gtitle", iAm ? "Your guess!" : `${gp.name} is guessing!`));
  if (iAm) {
    right.append(el("div", "mic", "🎤"), el("div", "gsub", "Say your guess out loud in the voice call. The others will vote."));
  } else {
    right.append(el("div", "gsub", "The real character is:"), el("div", "gname", t ? t.name : "?"));
  }
  right.appendChild(el("div", "votes", `✅ ${g.yes}    ❌ ${g.no}    (${g.yes + g.no}/${g.needed} voted)`));

  const actions = el("div", "gactions");
  if (iAm) {
    const cancel = el("button", "dark", "Cancel guess");
    cancel.onclick = () => send({ type: "guessCancel" });
    actions.appendChild(cancel);
  } else {
    const yes = el("button", "green big", "✅ Correct");
    const no = el("button", "big", "❌ Wrong");
    yes.disabled = no.disabled = g.myVote !== null;
    yes.onclick = () => send({ type: "vote", value: true });
    no.onclick = () => send({ type: "vote", value: false });
    actions.append(yes, no);
    if (g.myVote !== null) right.appendChild(el("div", "gsub", `You voted ${g.myVote ? "✅" : "❌"}. Waiting for the others...`));
  }
  right.appendChild(actions);
  card.append(left, right);
  ov.appendChild(card);
}

// ---------- game over ----------
function renderGameEnd(s) {
  const sorted = [...s.players].sort((a, b) => b.score - a.score);
  const podium = $("podium");
  podium.replaceChildren();
  const medals = ["🥇", "🥈", "🥉"];
  const order = [1, 0, 2].filter((i) => sorted[i]); // 2nd, 1st, 3rd
  for (const i of order) {
    const p = sorted[i];
    const pod = el("div", `pod p${i + 1}`);
    pod.style.setProperty("--accent", accent(s, p));
    const base = el("div", "base");
    base.append(el("div", "medal", medals[i]), el("div", "pts", `⭐ ${p.score}`));
    pod.append(avatar(p, "lg"), el("div", "pname", p.name), base);
    podium.appendChild(pod);
  }
  const box = $("scoreboard");
  box.replaceChildren();
  sorted.slice(3).forEach((p, i) => {
    const row = el("div", "score-row");
    row.append(el("span", "", `${i + 4}. ${p.name}`), el("span", "", `⭐ ${p.score}`));
    box.appendChild(row);
  });
}

// ---------- sounds and animations ----------
function playEvent(e, s) {
  const name = e.playerId ? nameOf(s, e.playerId) : "";
  if (e.type === "roundStart") {
    sfx.roundStart();
    setTimeout(sfx.deal, 350);
    const mine = e.playerId === myId;
    banner(`ROUND ${s.round}`, mine ? "YOU ASK FIRST!" : `${name.toUpperCase()} ASKS FIRST!`, "info");
    if (mine) setTimeout(sfx.yourTurn, 700);
  } else if (e.type === "turn") {
    if (e.playerId === myId) { sfx.yourTurn(); banner("YOUR TURN", "", "info"); }
    else sfx.turn();
  } else if (e.type === "correct") {
    sfx.correct();
    confetti(2400, 130);
    banner("CORRECT!", `${name}  +${e.points}`, "good");
  } else if (e.type === "wrong") {
    sfx.wrong();
    banner("WRONG!", `${name}  ${e.wrong}/3`, "bad");
  } else if (e.type === "out") {
    sfx.out();
  } else if (e.type === "gameEnd") {
    sfx.win();
    confetti(6000, 280);
    banner(`${(e.winnerIds || []).map((id) => nameOf(s, id)).join(" & ").toUpperCase()} WINS!`, "", "good");
  }
}

function handleEffects(s) {
  if (prev) {
    if (s.phase === "LOBBY") {
      if (s.players.length > prev.players.length) sfx.join();
      else if (s.players.length < prev.players.length) sfx.leave();
      const before = prev.you.slots.filter((x) => x.saved).length;
      const after = s.you.slots.filter((x) => x.saved).length;
      if (after > before) sfx.save();
    }
    if (s.guess && !prev.guess) sfx.guessStart();
    if (s.guess && prev.guess && s.guess.yes + s.guess.no > prev.guess.yes + prev.guess.no) {
      if (s.guess.yes > prev.guess.yes) sfx.voteYes(); else sfx.voteNo();
    }
  }
  const maxId = s.events.reduce((m, e) => Math.max(m, e.id), 0);
  if (lastEventId === null) { lastEventId = maxId; return; } // do not replay old events
  for (const e of s.events) {
    if (e.id > lastEventId) { lastEventId = e.id; playEvent(e, s); }
  }
}

// ---------- main state handler ----------
function onState(s) {
  showError("");

  // keep images only for cards that are on the table now
  for (const t of s.table) if (t.image) imgCache.set(t.key, t.image);
  const keys = new Set(s.table.map((t) => t.key));
  for (const k of [...imgCache.keys()]) if (!keys.has(k)) imgCache.delete(k);

  handleEffects(s);

  const isHost = s.hostId === myId;
  $("lobby").classList.toggle("hidden", s.phase !== "LOBBY");
  $("round").classList.toggle("hidden", s.phase !== "ROUND");
  $("gameend").classList.toggle("hidden", s.phase !== "GAME_END");
  $("hostbar").classList.toggle("hidden", !isHost || s.phase === "LOBBY");
  $("status").textContent = s.phase === "LOBBY" ? "Lobby: wait for your friends, then save your cards." : "";

  const chip = $("roundChip");
  chip.classList.toggle("hidden", s.phase === "LOBBY");
  chip.textContent = s.phase === "ROUND" ? `ROUND ${s.round}/${s.totalRounds}` : "FINAL";

  if (s.phase === "LOBBY") renderLobby(s);
  if (s.phase === "ROUND") {
    renderTurnBar(s);
    renderTable(s);
    $("log").textContent = s.log || "";
    $("nextBtn").classList.toggle("hidden", !isHost);
    $("nextBtn").textContent = s.round >= s.totalRounds ? "Finish game" : "Next round";
  }
  renderGuess(s);
  if (s.phase === "GAME_END") renderGameEnd(s);

  prev = s;
}

// ---------- start ----------
async function start() {
  // sound needs one click/tap before the browser allows it
  document.addEventListener("pointerdown", (e) => {
    unlock();
    if (e.target.closest("button")) sfx.click();
  });
  $("muteBtn").textContent = isMuted() ? "🔇" : "🔊";
  $("muteBtn").onclick = () => {
    setMuted(!isMuted());
    $("muteBtn").textContent = isMuted() ? "🔇" : "🔊";
  };
  $("lightbox").onclick = () => $("lightbox").classList.add("hidden");

  try {
    const sdk = new DiscordSDK(__CLIENT_ID__);
    await sdk.ready();

    const { code } = await sdk.commands.authorize({
      client_id: __CLIENT_ID__,
      response_type: "code",
      state: "",
      prompt: "none",
      scope: ["identify"],
    });

    const res = await fetch("/.proxy/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const { access_token } = await res.json();
    if (!access_token) throw new Error("Server did not return a token. Check the server window.");

    const auth = await sdk.commands.authenticate({ access_token });
    myId = auth.user.id;

    // Terms and Privacy links (opened outside Discord)
    try {
      const info = await (await fetch("/.proxy/api/info")).json();
      if (info.publicUrl) {
        const base = info.publicUrl.replace(/\/$/, "");
        const link = (id, path) => {
          $(id).onclick = (e) => { e.preventDefault(); sdk.commands.openExternalLink({ url: base + path }); };
        };
        link("termsLink", "/legal/terms.html");
        link("privacyLink", "/legal/privacy.html");
        $("legal").classList.remove("hidden");
      }
    } catch {}
    $("status").textContent = `Hello, ${auth.user.global_name || auth.user.username}! Joining the lobby...`;

    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/.proxy/ws`);
    ws.onopen = () => send({ type: "hello", instanceId: sdk.instanceId, accessToken: access_token });
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "state") onState(msg);
      else if (msg.type === "error") showError(msg.message);
    };
    ws.onclose = () => { $("status").textContent = "Disconnected. Close and reopen the activity."; };
    ws.onerror = () => showError("Could not connect to the game server (WebSocket). Check the two terminal windows.");

    $("startBtn").onclick = () => send({ type: "start" });
    $("resetBtn").onclick = () => send({ type: "reset" });
    $("nextBtn").onclick = () => send({ type: "nextRound" });
  } catch (err) {
    $("status").textContent = "Something failed:";
    showError(String(err && err.message ? err.message : JSON.stringify(err)));
  }
}

start();
