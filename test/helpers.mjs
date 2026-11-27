// Test helpers: start a real server, connect real WebSocket clients, play real games.
// Nothing is mocked except the Discord login (DEV_AUTH=1), which the server only honours
// when that env var is set.
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import WebSocket from "ws";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let portCounter = 4100 + (process.pid % 400);
export const nextPort = () => portCounter++;

// The server serves the built page, so tests that need a browser build it first. A
// placeholder client id is enough: they sign in through DEV_AUTH and never talk to Discord.
export function buildTheGame() {
  execFileSync(process.execPath, [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "build"], {
    cwd: ROOT,
    env: { ...process.env, VITE_CLIENT_ID: process.env.VITE_CLIENT_ID || "000000000000000000" },
    stdio: "pipe",
  });
}

export async function startServer(env = {}) {
  const port = nextPort();
  const proc = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DEV_AUTH: "1",
      VITE_CLIENT_ID: "000000000000000000",
      CLIENT_SECRET: "test-secret",
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];
  proc.stdout.on("data", (d) => logs.push(String(d)));
  proc.stderr.on("data", (d) => logs.push(String(d)));

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  for (;;) {
    if (proc.exitCode !== null) throw new Error("server exited early:\n" + logs.join(""));
    try {
      const r = await fetch(base + "/healthz");
      if (r.ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error("server did not start:\n" + logs.join(""));
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    port, base, proc, logs,
    log: () => logs.join(""),
    async stop() {
      proc.kill();
      try { await once(proc, "exit"); } catch {}
    },
  };
}

// One player's browser tab.
export class Client {
  constructor(server, id, name) {
    this.server = server; this.id = id; this.name = name;
    this.states = []; this.messages = []; this.closed = false;
    // Every image this tab has ever been sent, keyed by card id, exactly like the real
    // client's imgCache. Used to prove the right picture reaches the right screen.
    this.imgCache = new Map();
  }

  async connect({ instanceId = "inst-1", path = "/ws", token = null } = {}) {
    const url = `ws://127.0.0.1:${this.server.port}${path}`;
    this.ws = new WebSocket(url);
    await once(this.ws, "open");
    this.ws.on("message", (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      this.messages.push(m);
      if (m.type === "state") {
        this.states.push(m);
        for (const t of m.table) if (t.image) this.imgCache.set(t.key, t.image);
        const keys = new Set(m.table.map((t) => t.key));
        for (const k of [...this.imgCache.keys()]) if (!keys.has(k)) this.imgCache.delete(k);
      }
    });
    this.ws.on("close", () => { this.closed = true; });
    this.send({ type: "hello", instanceId, accessToken: token ?? `dev.${this.id}.${this.name}` });
    return this;
  }

  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  get state() { return this.states[this.states.length - 1] ?? null; }
  get me() { return this.state?.players.find((p) => p.id === this.id) ?? null; }

  // What this tab can actually display for a given holder: the cached image, or null.
  shownFor(holderId) {
    const e = this.state?.table.find((t) => t.holderId === holderId);
    if (!e) return null;
    return { name: e.name, key: e.key, image: this.imgCache.get(e.key) ?? null };
  }

  async waitFor(pred, label = "condition", ms = 8000) {
    if (this.state && pred(this.state)) return this.state;
    const deadline = Date.now() + ms;
    for (;;) {
      await new Promise((r) => setTimeout(r, 25));
      if (this.state && pred(this.state)) return this.state;
      if (Date.now() > deadline) {
        throw new Error(`${this.name}: timed out waiting for ${label}. last state: ` +
          JSON.stringify(this.state && { phase: this.state.phase, round: this.state.round, turn: this.state.turn?.currentId, roundDone: this.state.roundDone }));
      }
    }
  }

  async waitForMessage(type, ms = 8000) {
    const start = this.messages.length;
    const deadline = Date.now() + ms;
    for (;;) {
      const hit = this.messages.slice(start).find((m) => m.type === type);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 25));
      if (Date.now() > deadline) throw new Error(`${this.name}: no "${type}" message arrived`);
    }
  }

  close() { this.ws?.close(); }
}

// A unique, traceable "picture". The server never decodes images, so a distinctive
// base64 payload is enough to prove identity end to end.
export function picture(tag) {
  const b64 = Buffer.from(`PICTURE[${tag}]`).toString("base64").replace(/=+$/, "");
  return "data:image/jpeg;base64," + b64.replace(/[^A-Za-z0-9+/]/g, "A");
}
export const tagOf = (dataUrl) => {
  const b64 = dataUrl.replace("data:image/jpeg;base64,", "");
  const s = Buffer.from(b64, "base64").toString("utf8");
  const m = /^PICTURE\[(.*)\]/.exec(s);
  return m ? m[1] : null;
};

export async function join(server, specs, instanceId = "inst-1") {
  const clients = [];
  for (const [id, name] of specs) {
    const c = new Client(server, id, name);
    await c.connect({ instanceId });
    await c.waitFor((s) => s.players.some((p) => p.id === id), `${name} to appear`);
    clients.push(c);
  }
  // everyone should see everyone
  for (const c of clients) await c.waitFor((s) => s.players.length === specs.length, "full roster");
  return clients;
}

// Upload all 3 cards for every client. Card names and pictures are tagged with the
// owner and round so a wrong deal is impossible to miss.
export async function uploadAll(clients, rounds = 3) {
  for (const c of clients) {
    for (let i = 0; i < rounds; i++) {
      c.send({ type: "upload", slot: i, name: `${c.name}-card${i + 1}`, image: picture(`${c.name}:${i + 1}`) });
      await c.waitForMessage("uploaded");
    }
  }
  for (const c of clients) await c.waitFor((s) => s.players.every((p) => p.uploaded === rounds), "all cards in");
}

// Start a game reliably. The host is whoever the server says it is, and the start is
// retried once, because a single dropped start message would otherwise look like a
// mysterious timeout much later in the test.
export async function startGame(clients) {
  for (const c of clients) {
    await c.waitFor((s) => s.players.every((p) => p.uploaded === s.cardsPerPlayer), "everyone ready", 15000);
  }
  const hostId = clients[0].state.hostId;
  const host = clients.find((c) => c.id === hostId) ?? clients[0];
  host.send({ type: "start" });
  try {
    await host.waitFor((s) => s.phase === "ROUND", "the game to start", 5000);
  } catch {
    host.send({ type: "start" }); // one retry
    await host.waitFor((s) => s.phase === "ROUND", "the game to start (retry)", 10000);
  }
  for (const c of clients) await c.waitFor((s) => s.phase === "ROUND", `${c.name} to reach the table`, 15000);
  return clients;
}
