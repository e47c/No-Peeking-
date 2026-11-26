// TASK 2 - edge cases and the bugs found while reading the code.
import test from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { startServer, Client, join, uploadAll, picture, startGame } from "./helpers.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dbg = async (s) => (await fetch(s.base + "/__debug/rooms")).json();

async function startedGame(server, specs, instanceId) {
  const cs = await join(server, specs, instanceId);
  await uploadAll(cs);
  return startGame(cs);
}

test("a full room of 12 deals a clean permutation and nobody holds their own card", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const specs = Array.from({ length: 12 }, (_, i) => ["m" + i, "P" + i]);
  const cs = await startedGame(server, specs, "full");

  const room = Object.values((await dbg(server)).rooms)[0];
  const deal = room.deal;
  assert.equal(deal.length, 12);
  assert.equal(new Set(deal.map((d) => d[0])).size, 12, "every player holds exactly one card");
  assert.equal(new Set(deal.map((d) => d[1])).size, 12, "every card is held exactly once");
  assert.equal(deal.filter(([h, o]) => h === o).length, 0, "nobody may hold their own card");
  for (const c of cs) assert.equal(c.state.table.length, 11, c.name + " should see 11 tiles, not their own");
  cs.forEach((c) => c.close());
});

test("a 13th player is turned away from a full room", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const cs = await join(server, Array.from({ length: 12 }, (_, i) => ["f" + i, "P" + i]), "full13");
  const extra = new Client(server, "f99", "Extra");
  await extra.connect({ instanceId: "full13" });
  const err = await extra.waitForMessage("error");
  assert.match(err.message, /full/i);
  extra.close();
  cs.forEach((c) => c.close());
});

test("a newcomer cannot join a game already in progress", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const cs = await startedGame(server, [["n1", "Ana"], ["n2", "Ben"]], "midjoin");
  const late = new Client(server, "n9", "Late");
  await late.connect({ instanceId: "midjoin" });
  const err = await late.waitForMessage("error");
  assert.match(err.message, /already running/i);
  late.close();
  cs.forEach((c) => c.close());
});

test("the host leaving mid-game hands the role to someone still online", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const cs = await startedGame(server, [["h1", "Host"], ["h2", "Ben"], ["h3", "Cleo"]], "hostgone");
  assert.equal(cs[1].state.hostId, "h1");
  cs[0].close();
  await cs[1].waitFor((s) => s.hostId !== "h1", "a new host");
  assert.ok(["h2", "h3"].includes(cs[1].state.hostId));
  assert.equal(cs[1].state.players.find((p) => p.id === "h1").online, false,
    "a player who leaves mid-game is kept so they can come back");
  cs.slice(1).forEach((c) => c.close());
});

test("reconnecting mid-game restores the table, the pictures and the score", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const cs = await startedGame(server, [["r1", "Ana"], ["r2", "Ben"], ["r3", "Cleo"]], "recon");
  const tiles = cs[1].state.table.length;
  const imgs = cs[1].imgCache.size;
  assert.ok(imgs > 0);
  cs[1].close();
  await wait(200);

  const back = new Client(server, "r2", "Ben");
  await back.connect({ instanceId: "recon" });
  await back.waitFor((s) => s.phase === "ROUND", "rejoin");
  assert.equal(back.state.table.length, tiles, "same number of tiles after reconnecting");
  assert.equal(back.imgCache.size, imgs, "every picture is sent again to the fresh tab");
  assert.ok(back.state.table.every((e) => back.imgCache.has(e.key)),
    "a reconnected tab must not be left with blank cards");
  back.close();
  cs[0].close();
  cs[2].close();
});

test("the same account in a second tab takes over and the first is told", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const a = new Client(server, "dup", "Dup");
  await a.connect({ instanceId: "dup" });
  await a.waitFor((s) => s.players.length === 1, "first tab");
  const b = new Client(server, "dup", "Dup");
  await b.connect({ instanceId: "dup" });
  await a.waitForMessage("replaced");
  await b.waitFor((s) => s.players.length === 1, "second tab");
  assert.equal(b.state.players.length, 1, "one account must not appear twice");
  a.close();
  b.close();
});

test("malformed uploads are all refused, and the answer says which card", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const cs = await join(server, [["u1", "Ana"], ["u2", "Ben"]], "uploads");
  const ana = cs[0];
  const bad = {
    "too big": "data:image/jpeg;base64," + "A".repeat(800000),
    "a png": "data:image/png;base64,iVBORw0KGgo",
    "not a data url": "hello world",
    "empty": "",
    "a number": 12345,
    "null": null,
    "bad base64": "data:image/jpeg;base64,***",
    "an svg": "data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==",
  };
  for (const [label, image] of Object.entries(bad)) {
    const n = ana.messages.length;
    ana.send({ type: "upload", slot: 1, name: "x", image });
    const err = await ana.waitForMessage("error");
    assert.match(err.message, /rejected/i, label + " should be refused");
    assert.equal(err.slot, 1, "the error for " + label + " must say which card it belongs to");
    assert.ok(!ana.messages.slice(n).some((m) => m.type === "uploaded"), label + " must not be accepted");
  }
  ana.send({ type: "upload", slot: 99, name: "x", image: picture("Ana:1") });
  const err = await ana.waitForMessage("error");
  assert.match(err.message, /does not exist/i);
  cs.forEach((c) => c.close());
});

test("nothing is accepted from a connection that never said hello", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const ws = new WebSocket("ws://127.0.0.1:" + server.port + "/ws");
  await new Promise((r) => ws.once("open", r));
  const got = [];
  ws.on("message", (m) => got.push(String(m)));
  for (const type of ["upload", "start", "nextRound", "reset", "guessStart", "vote", "pass", "react"]) {
    ws.send(JSON.stringify({ type, slot: 0, name: "x", image: picture("a"), value: true }));
  }
  ws.send("not even json");
  await wait(300);
  assert.equal(got.length, 0, "an unauthenticated connection must get nothing back");
  assert.equal((await dbg(server)).roomCount, 0, "and must not create a room");
  ws.close();
});

test("a bad login is refused", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const c = new Client(server, "bad", "Bad");
  await c.connect({ instanceId: "nope", token: "not-a-dev-token" });
  const err = await c.waitForMessage("error");
  assert.match(err.message, /login/i);
  assert.equal((await dbg(server)).roomCount, 0);
  c.close();
});

test("only the host may start, advance a round, or go back to the lobby", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const cs = await join(server, [["g1", "Host"], ["g2", "Ben"]], "auth");
  await uploadAll(cs);

  cs[1].send({ type: "start" });
  await wait(200);
  assert.equal(cs[0].state.phase, "LOBBY", "a non-host must not be able to start the game");

  cs[0].send({ type: "start" });
  for (const c of cs) await c.waitFor((s) => s.phase === "ROUND", "round");

  cs[1].send({ type: "nextRound" });
  await wait(200);
  assert.equal(cs[0].state.round, 1, "a non-host must not be able to advance the round");

  cs[1].send({ type: "reset" });
  await wait(200);
  assert.equal(cs[0].state.phase, "ROUND", "a non-host must not be able to wipe the game");
  cs.forEach((c) => c.close());
});

test("the game cannot start before everyone is ready", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const cs = await join(server, [["w1", "Ana"], ["w2", "Ben"]], "notready");
  cs[0].send({ type: "start" });
  const err = await cs[0].waitForMessage("error");
  assert.match(err.message, /not everyone/i);
  assert.equal(cs[0].state.phase, "LOBBY");
  cs.forEach((c) => c.close());
});

test("one player alone cannot start a game", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const c = new Client(server, "solo", "Solo");
  await c.connect({ instanceId: "solo" });
  await c.waitFor((s) => s.players.length === 1, "lobby");
  for (let i = 0; i < 3; i++) {
    c.send({ type: "upload", slot: i, name: "n" + i, image: picture("Solo:" + (i + 1)) });
    await c.waitForMessage("uploaded");
  }
  c.send({ type: "start" });
  const err = await c.waitForMessage("error");
  assert.match(err.message, /not everyone/i);
  assert.equal(c.state.phase, "LOBBY", "a one-player game would deal a player their own card");
  c.close();
});

test("rapid clicking cannot break the round", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const cs = await startedGame(server, [["s1", "Ana"], ["s2", "Ben"], ["s3", "Cleo"]], "spam");
  const asker = cs.find((c) => c.id === cs[0].state.turn.currentId);
  const other = cs.find((c) => c !== asker);

  for (let i = 0; i < 50; i++) other.send({ type: "react", value: "yes" });
  await wait(300);
  assert.ok(cs[0].state.events.filter((e) => e.type === "react").length <= 2,
    "reacts must be rate limited");

  for (let i = 0; i < 50; i++) asker.send({ type: "guessStart" });
  await asker.waitFor((s) => !!s.guess, "one guess");
  assert.equal(asker.state.guess.guesserId, asker.id, "50 clicks must open exactly one guess");

  const turnBefore = asker.state.turn.currentId;
  for (let i = 0; i < 50; i++) asker.send({ type: "pass" });
  await wait(300);
  assert.equal(asker.state.turn.currentId, turnBefore, "passing is refused while a guess is open");
  assert.ok(asker.state.guess, "and the guess stays open");
  cs.forEach((c) => c.close());
});

test("a vote from the guesser, or a repeat vote, cannot swing the result", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const cs = await startedGame(server, [["q1", "Ana"], ["q2", "Ben"], ["q3", "Cleo"], ["q4", "Dan"]], "votes");
  const asker = cs.find((c) => c.id === cs[0].state.turn.currentId);
  const others = cs.filter((c) => c !== asker);

  asker.send({ type: "guessStart" });
  await asker.waitFor((s) => !!s.guess, "guess");

  asker.send({ type: "vote", value: true });
  await wait(150);
  assert.equal(asker.state.guess.yes, 0, "the guesser's own vote must not count");

  for (let i = 0; i < 10; i++) others[0].send({ type: "vote", value: true });
  await wait(200);
  assert.equal(asker.state.guess.yes, 1, "one voter counts once however often they click");
  cs.forEach((c) => c.close());
});

test("pressing I-know-it with nobody online to judge says so instead of doing nothing", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const cs = await startedGame(server, [["d1", "Ana"], ["d2", "Ben"], ["d3", "Cleo"]], "drain");

  const ana = cs[0];
  cs[1].close();
  cs[2].close();
  await ana.waitFor((s) => s.players.filter((p) => p.online).length === 1, "alone");
  for (let i = 0; i < 5 && ana.state.turn.currentId !== ana.id; i++) {
    ana.send({ type: "pass" });
    await wait(150);
  }
  assert.equal(ana.state.turn.currentId, ana.id, "the last player online should hold the turn");

  ana.send({ type: "guessStart" });
  const err = await ana.waitForMessage("error");
  assert.match(err.message, /nobody else is online/i);
  assert.equal(ana.state.guess, null);
  assert.equal(ana.me.status, "playing", "and it must not quietly cost them anything");
  ana.close();
});

test("the number of rooms one account can create is capped", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const made = [];
  for (let i = 0; i < 210; i++) {
    const c = new Client(server, "flood", "Flood");
    await c.connect({ instanceId: "room-" + i });
    made.push(c);
  }
  await wait(600); // the refusals arrive asynchronously
  const { roomCount } = await dbg(server);
  assert.ok(roomCount <= 200, "rooms must be capped, got " + roomCount);
  const refused = made.filter((c) => c.messages.some((m) => m.type === "error" && /busy/i.test(m.message)));
  assert.ok(refused.length > 0, "past the cap a new room must be refused with a clear message");
  made.forEach((c) => c.close());
});

test("every picture is gone from server memory once the last player leaves", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const cs = await startedGame(server, [["z1", "Ana"], ["z2", "Ben"]], "wipe");
  assert.equal((await dbg(server)).roomCount, 1);
  cs.forEach((c) => c.close());
  await wait(400);
  assert.equal((await dbg(server)).roomCount, 0, "the room and every picture in it must be dropped");
});

// The test-only doors must be firmly shut on the real server. DEV_AUTH is never set on
// Render, and without it a fake login must be refused and the debug view must not exist.
test("with DEV_AUTH off, fake logins are refused and the debug view is gone", async (t) => {
  const server = await startServer({ DEV_AUTH: "" });
  t.after(() => server.stop());

  const debug = await fetch(server.base + "/__debug/rooms");
  assert.equal(debug.status, 404, "the debug view must not be reachable in production");

  const health = await fetch(server.base + "/healthz");
  assert.equal(health.status, 200, "but the health check still works");

  const c = new Client(server, "a1", "Ana");
  await c.connect({ instanceId: "prod" });
  const err = await c.waitForMessage("error", 20000);
  assert.match(err.message, /login/i, "a dev token must not get in");
  c.close();
});
