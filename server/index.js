import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { CLIENT_ID, CLIENT_SECRET } from "../config.js";

// ====== Settings you can change ======
const MIN_PLAYERS = 2;            // keep this at 2 or more (with 1 player there is nobody else's card to deal)
const MAX_PLAYERS = 12;           // one game room holds at most this many players
const CARDS_PER_PLAYER = 3;       // one image per round
const ROOM_LIFETIME_MS = 2 * 60 * 60 * 1000; // wipe a room after 2 hours
const MAX_ROOMS = 200;            // a safety cap: instanceId comes from the client, so rooms were unbounded
const PING_MS = 30 * 1000;        // how often we check that a connection is still alive
// =====================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// One place for log lines, so they all look the same in the host's log viewer.
const log = (...a) => console.log(new Date().toISOString(), ...a);
const stats = () => {
  let players = 0;
  for (const r of rooms.values()) players += r.players.size;
  return `rooms=${rooms.size} players=${players}`;
};
if (!CLIENT_ID || !CLIENT_SECRET) console.warn("WARNING: CLIENT_ID or CLIENT_SECRET is missing!");

const app = express();

// Discord serves the Activity from discordsays.com and forwards every request whose path
// starts with /.proxy to this server with that prefix ALREADY REMOVED. Outside Discord
// (a plain browser, or an automated test) nothing removes it, so the client's /.proxy/...
// URLs would 404. Stripping it here lets the exact same build run in both places.
app.use((req, _res, next) => {
  if (req.url === "/.proxy" || req.url.startsWith("/.proxy/")) req.url = req.url.slice(7) || "/";
  next();
});

app.use(express.json());

// Small helper routes
app.get("/healthz", (req, res) => res.send("ok"));
app.get("/api/info", (req, res) => res.json({ publicUrl: process.env.PUBLIC_URL || "" }));
// Terms of Service and Privacy Policy pages (they live in the docs folder)
app.use("/legal", express.static(path.join(__dirname, "../docs")));

// Trade the Discord "code" for an access token
app.post("/api/token", async (req, res) => {
  try {
    const response = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        code: req.body.code,
      }),
    });
    const data = await response.json();
    if (!data.access_token) {
      console.error("Discord said:", data);
      return res.status(400).json({ error: "token_failed" });
    }
    res.json({ access_token: data.access_token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

// The game page (made by "npm run build") is served from the dist folder
app.use(express.static(path.join(__dirname, "../dist")));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });

// Accept both /ws (inside Discord, where the proxy already stripped /.proxy) and
// /.proxy/ws (a plain browser or an automated test, where nothing stripped it).
server.on("upgrade", (req, socket, head) => {
  let p = (req.url || "").split("?")[0];
  while (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (p !== "/ws" && p !== "/.proxy/ws") return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

// rooms: one per Discord activity session. Everything lives in memory only.
const rooms = new Map();

function deleteRoom(id, why = "empty") {
  const room = rooms.get(id);
  if (!room) return;
  clearTimeout(room.timer);
  rooms.delete(id); // images are deleted with the room
  log(`room closed (${why}) id=${id} ${stats()}`);
}

function touch(id, room) {
  clearTimeout(room.timer);
  room.timer = setTimeout(() => deleteRoom(id, "idle for too long"), ROOM_LIFETIME_MS);
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Deal for the current round: everyone gets another player's card, never their own.
// Shuffle the players, then each one holds the card of the NEXT one in the circle.
function dealRound(room) {
  const order = shuffle([...room.players.keys()]);
  room.deal = new Map(); // holderId -> ownerId
  room.guess = null;
  room.solved = 0;
  room.log = "";
  for (const p of room.players.values()) { p.status = "playing"; p.wrong = 0; p.lastPoints = 0; p.seen = new Set(); }
  order.forEach((holderId, i) => room.deal.set(holderId, order[(i + 1) % order.length]));
  // who asks first? a fresh random turn order every round
  room.turn = { order: shuffle([...room.players.keys()]), idx: 0 };
  if (!askerId(room)) advanceTurn(room, false);
  emit(room, "roundStart", askerId(room));
}

// Short "things that just happened" list. The page uses it for sounds and animations.
function emit(room, type, playerId, extra = {}) {
  room.seq += 1;
  room.events = [...room.events, { id: room.seq, type, playerId, ...extra }].slice(-10);
}

// The player whose turn it is to ask questions (null if nobody can)
function askerId(room) {
  const t = room.turn;
  if (!t) return null;
  const p = room.players.get(t.order[t.idx]);
  return p && p.status === "playing" && p.ws ? p.id : null;
}

// Pass the turn to the next player who is still playing and online
function advanceTurn(room, announce = true) {
  const t = room.turn;
  if (!t) return;
  const n = t.order.length;
  for (let k = 1; k <= n; k++) {
    const i = (t.idx + k) % n;
    const p = room.players.get(t.order[i]);
    if (p && p.status === "playing" && p.ws) {
      t.idx = i;
      if (announce) emit(room, "turn", p.id);
      return;
    }
  }
}

function votersOf(room, g) {
  return [...room.players.values()].filter((p) => p.id !== g.guesserId && p.ws).map((p) => p.id);
}

function roundDone(room) {
  return [...room.players.values()].every((p) => p.status !== "playing" || !p.ws);
}

// Decide a guess when enough votes are in. Correct needs a strict majority of YES votes.
function resolveGuess(room) {
  const g = room.guess;
  if (!g || room.phase !== "ROUND") return;
  const voters = votersOf(room, g);
  const n = voters.length;
  if (n === 0) { room.guess = null; return; }
  const yes = voters.filter((id) => g.votes.get(id) === true).length;
  const no = voters.filter((id) => g.votes.get(id) === false).length;
  let result = null;
  if (yes * 2 > n) result = "correct";
  else if (no * 2 >= n) result = "wrong";
  if (!result) return;

  const p = room.players.get(g.guesserId);
  if (result === "correct") {
    const points = Math.max(1, room.players.size - room.solved);
    room.solved += 1;
    p.status = "solved";
    p.score += points;
    p.lastPoints = points;
    p.hist[room.round] = points;
    room.log = `✅ ${p.name} guessed right! +${points} points`;
    emit(room, "correct", p.id, { points });
  } else {
    p.wrong += 1;
    emit(room, "wrong", p.id, { wrong: p.wrong });
    if (p.wrong >= 3) {
      emit(room, "out", p.id); p.status = "out"; room.log = `❌ ${p.name} was wrong 3 times and is out for this round`; }
    else room.log = `❌ ${p.name} was wrong (${p.wrong}/3)`;
  }
  room.guess = null;
  advanceTurn(room); // after a guess (right or wrong) the turn moves on
}

function tableFor(room, userId) {
  if (room.phase !== "ROUND" || !room.deal) return [];
  const out = [];
  const me = room.players.get(userId);
  for (const [holderId, ownerId] of room.deal) {
    // NEVER send the player's own card while they are still guessing
    if (holderId === userId && me && me.status === "playing") continue;
    const card = room.players.get(ownerId)?.cards[room.round];
    if (card) out.push({ holderId, name: card.name, key: card.id, image: card.image });
  }
  return out;
}

function stateFor(room, userId) {
  const me = room.players.get(userId);
  return {
    type: "state",
    epoch: room.epoch,
    phase: room.phase,
    round: room.round + 1,
    totalRounds: CARDS_PER_PLAYER,
    table: tableFor(room, userId),
    hostId: room.hostId,
    minPlayers: MIN_PLAYERS,
    cardsPerPlayer: CARDS_PER_PLAYER,
    you: {
      id: userId,
      // you only get names of YOUR OWN uploads, never other people's
      slots: me ? me.cards.map((c) => (c ? { saved: true, name: c.name } : { saved: false })) : [],
    },
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      uploaded: p.cards.filter(Boolean).length,
      online: !!p.ws,
      score: p.score,
      status: p.status,
      wrong: p.wrong,
      lastPoints: p.lastPoints,
      hist: p.hist,
    })),
    guess: room.guess
      ? (() => {
          const g = room.guess;
          const voters = votersOf(room, g);
          return {
            guesserId: g.guesserId,
            needed: voters.length,
            yes: voters.filter((id) => g.votes.get(id) === true).length,
            no: voters.filter((id) => g.votes.get(id) === false).length,
            myVote: g.votes.has(userId) ? g.votes.get(userId) : null,
          };
        })()
      : null,
    turn: room.turn ? { currentId: askerId(room), order: room.turn.order } : null,
    events: room.events,
    log: room.log,
    roundDone: room.phase === "ROUND" && roundDone(room),
  };
}

function broadcast(room) {
  for (const p of room.players.values()) {
    if (!p.ws) continue;
    const st = stateFor(room, p.id);
    const newKeys = [];
    for (const t of st.table) {
      if (p.seen.has(t.key)) delete t.image; // this player already has it
      else newKeys.push(t.key);
    }
    send(p.ws, st);
    newKeys.forEach((k) => p.seen.add(k));
  }
}

// Tests and local runs need to sign in without a real Discord account. Fake logins are
// accepted ONLY when DEV_AUTH=1 is set, which never happens on Render.
const DEV_AUTH = process.env.DEV_AUTH === "1";
if (DEV_AUTH) console.warn("WARNING: DEV_AUTH=1 - fake logins are accepted. Never use this in production.");

function devUser(token) {
  const m = /^dev[.]([A-Za-z0-9_-]{1,32})[.]([^.]{1,32})$/.exec(token);
  return m ? { id: m[1], username: m[2], global_name: m[2], avatar: null } : null;
}

async function verifyToken(token) {
  if (DEV_AUTH) { const u = devUser(token); if (u) return u; }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${token}` }, signal: ctl.signal });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function allReady(room) {
  return (
    room.players.size >= MIN_PLAYERS &&
    [...room.players.values()].every((p) => p.cards.every(Boolean))
  );
}

wss.on("connection", (ws) => {
  ws.ctx = null;
  ws.alive = true;
  ws.on("pong", () => { ws.alive = true; });

  const handle = async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ---- first message: who are you? ----
    if (msg.type === "hello") {
      if (ws.ctx || typeof msg.instanceId !== "string" || typeof msg.accessToken !== "string") return;
      const user = await verifyToken(msg.accessToken);
      if (!user || typeof user.id !== "string") return send(ws, { type: "error", message: "Login check failed. Please reopen the activity." });

      const roomId = msg.instanceId.slice(0, 100);
      let room = rooms.get(roomId);
      if (!room && rooms.size >= MAX_ROOMS) {
        console.warn("Refused a new room: the", MAX_ROOMS, "room limit is reached");
        return send(ws, { type: "error", message: "The server is busy. Please try again in a few minutes." });
      }
      if (!room) {
        room = { players: new Map(), hostId: null, phase: "LOBBY", round: 0, deal: null, guess: null, solved: 0, log: "", turn: null, events: [], seq: 0, cardSeq: 0, epoch: Math.random().toString(36).slice(2, 8) + Date.now().toString(36), timer: null };
        rooms.set(roomId, room);
        log(`room opened id=${roomId} ${stats()}`);
      }
      let player = room.players.get(user.id);
      const rejoined = !!player;
      if (player) {
        if (player.ws && player.ws !== ws) { player.ws.ctx = null; send(player.ws, { type: "replaced" }); player.ws.close(); }
        player.ws = ws;
        player.seen = new Set(); // this browser has no images yet
      } else {
        if (room.phase !== "LOBBY") {
          return send(ws, { type: "error", message: "A game is already running. Wait for it to end." });
        }
        if (room.players.size >= MAX_PLAYERS) {
          return send(ws, { type: "error", message: "This game room is full." });
        }
        player = {
          id: user.id,
          name: user.global_name || user.username,
          avatar: user.avatar,
          ws,
          cards: Array(CARDS_PER_PLAYER).fill(null),
          seen: new Set(),
          score: 0,
          hist: Array(CARDS_PER_PLAYER).fill(0),
          lastReact: 0,
          status: "playing", // playing | solved | out
          wrong: 0,
          lastPoints: 0,
        };
        room.players.set(user.id, player);
      }
      if (!room.hostId || !room.players.has(room.hostId)) room.hostId = user.id;
      ws.ctx = { roomId, userId: user.id };
      touch(roomId, room);
      log(`${rejoined ? "rejoined" : "joined"} room=${roomId} players=${room.players.size} phase=${room.phase}`);
      return broadcast(room);
    }

    if (!ws.ctx) return;
    const room = rooms.get(ws.ctx.roomId);
    if (!room) return;
    const userId = ws.ctx.userId;
    const player = room.players.get(userId);
    if (!player) return;
    touch(ws.ctx.roomId, room);

    // ---- upload one image + name ----
    if (msg.type === "upload") {
      if (room.phase !== "LOBBY") return;
      const slot = Number(msg.slot);
      const name = typeof msg.name === "string" ? msg.name.trim().slice(0, 30) : "";
      const image = msg.image;
      if (!Number.isInteger(slot) || slot < 0 || slot >= CARDS_PER_PLAYER) {
        return send(ws, { type: "error", message: "That card does not exist." });
      }
      if (!name) return send(ws, { type: "error", slot, message: "Type a name for the character." });
      if (typeof image !== "string" || image.length > 700000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) {
        return send(ws, { type: "error", slot, message: "Image rejected (must be a small JPEG)." });
      }
      player.cards[slot] = { id: `${room.epoch}.${++room.cardSeq}`, name, image }; // a new id for every upload
      send(ws, { type: "uploaded", slot }); // tells the uploader it worked
      return broadcast(room);
    }

    // ---- host presses Start ----
    if (msg.type === "start") {
      if (userId !== room.hostId || room.phase !== "LOBBY") return;
      if (!allReady(room)) return send(ws, { type: "error", message: "Not everyone is ready." });
      room.phase = "ROUND";
      room.round = 0;
      log(`game started room=${ws.ctx.roomId} players=${room.players.size}`);
      dealRound(room);
      return broadcast(room);
    }

    // ---- host goes to the next round: this round's images are deleted ----
    if (msg.type === "nextRound") {
      if (userId !== room.hostId || room.phase !== "ROUND") return;
      for (const p of room.players.values()) p.cards[room.round] = null; // delete
      room.guess = null;
      room.round += 1;
      log(`round ${room.round} finished room=${ws.ctx.roomId} (its pictures are now deleted)`);
      if (room.round >= CARDS_PER_PLAYER) {
        room.phase = "GAME_END";
        room.deal = null;
        room.turn = null;
        const top = Math.max(...[...room.players.values()].map((p) => p.score));
        emit(room, "gameEnd", null, { winnerIds: top > 0 ? [...room.players.values()].filter((p) => p.score === top).map((p) => p.id) : [] });
      } else {
        dealRound(room);
      }
      return broadcast(room);
    }

    // ---- guessing and voting ----
    if (msg.type === "guessStart") {
      if (room.phase !== "ROUND" || room.guess || player.status !== "playing" || askerId(room) !== userId) return;
      if (votersOf(room, { guesserId: userId }).length === 0) {
        return send(ws, { type: "error", message: "Nobody else is online to judge your guess." });
      }
      room.guess = { guesserId: userId, votes: new Map() };
      resolveGuess(room); // (ends at once if nobody can vote)
      return broadcast(room);
    }
    if (msg.type === "react") {
      if (room.phase !== "ROUND" || room.guess) return;
      const cur = askerId(room);
      if (!cur || cur === userId) return; // only the OTHER players answer
      if (!["yes", "no", "maybe"].includes(msg.value)) return;
      const t = Date.now();
      if (t - player.lastReact < 450) return; // no spamming
      player.lastReact = t;
      emit(room, "react", userId, { value: msg.value, to: cur });
      return broadcast(room);
    }
    if (msg.type === "pass") {
      if (room.phase !== "ROUND" || room.guess) return;
      if (userId !== askerId(room) && userId !== room.hostId) return; // host can skip a sleeping player
      advanceTurn(room);
      return broadcast(room);
    }
    if (msg.type === "guessCancel") {
      if (!room.guess || room.guess.guesserId !== userId) return;
      room.guess = null;
      return broadcast(room);
    }
    if (msg.type === "vote") {
      if (!room.guess || room.guess.guesserId === userId || typeof msg.value !== "boolean") return;
      room.guess.votes.set(userId, msg.value);
      resolveGuess(room);
      return broadcast(room);
    }

    // ---- host goes back to lobby: ALL images are deleted ----
    if (msg.type === "reset") {
      if (userId !== room.hostId) return;
      for (const [id, p] of [...room.players]) if (!p.ws) room.players.delete(id); // people who left cannot block the next game
      for (const p of room.players.values()) {
        p.seen = new Set();
        p.cards = Array(CARDS_PER_PLAYER).fill(null);
        p.score = 0; p.hist = Array(CARDS_PER_PLAYER).fill(0); p.status = "playing"; p.wrong = 0; p.lastPoints = 0;
      }
      room.guess = null;
      room.turn = null;
      room.log = "";
      room.phase = "LOBBY";
      room.round = 0;
      room.deal = null;
      return broadcast(room);
    }
  };
  ws.on("message", (raw) => { handle(raw).catch((err) => console.error("message error:", err)); });
  ws.on("error", () => {});

  ws.on("close", () => {
    if (!ws.ctx) return;
    const { roomId, userId } = ws.ctx;
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(userId);
    if (!player || player.ws !== ws) return;

    if (room.phase === "LOBBY") room.players.delete(userId); // their images go too
    else player.ws = null; // keep them so they can come back mid-game

    const online = [...room.players.values()].filter((p) => p.ws);
    log(`left room=${roomId} phase=${room.phase} still online=${online.length}`);
    if (online.length === 0) return deleteRoom(roomId, "everybody left");
    if (!room.players.has(room.hostId) || !room.players.get(room.hostId).ws) room.hostId = online[0].id;
    if (room.phase === "ROUND" && room.turn && room.turn.order[room.turn.idx] === userId) advanceTurn(room);
    if (room.guess) {
      if (room.guess.guesserId === userId) room.guess = null;
      else resolveGuess(room);
    }
    broadcast(room);
  });
});

// Drop connections that stopped answering, so a vanished player cannot hold up the turn.
const pinger = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.alive === false) { console.log("Dropping a connection that stopped answering"); ws.terminate(); continue; }
    ws.alive = false;
    try { ws.ping(); } catch {}
  }
}, PING_MS);
pinger.unref?.();

process.on("unhandledRejection", (err) => console.error("unhandled:", err));
process.on("uncaughtException", (err) => console.error("uncaught:", err));

// Lets the test suite look at real server memory and prove that pictures are actually
// gone after each round. Only mounted when DEV_AUTH=1, which never happens on Render.
if (DEV_AUTH) {
  app.get("/__debug/rooms", (_req, res) => {
    const out = {};
    for (const [id, room] of rooms) {
      out[id] = {
        phase: room.phase,
        round: room.round,
        hostId: room.hostId,
        players: [...room.players.values()].map((p) => ({
          id: p.id,
          online: !!p.ws,
          status: p.status,
          score: p.score,
          seen: [...p.seen],
          // the actual bytes still held in memory, per slot
          cards: p.cards.map((c) => (c ? { id: c.id, name: c.name, imageBytes: c.image.length } : null)),
        })),
        deal: room.deal ? [...room.deal] : null,
      };
    }
    res.json({ roomCount: rooms.size, rooms: out });
  });
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => log(`No peeking! server listening on port ${PORT} (players per room: ${MIN_PLAYERS}-${MAX_PLAYERS}, rounds: ${CARDS_PER_PLAYER})`));
