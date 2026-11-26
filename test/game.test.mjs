// The scoring and round rules, played out over a real server.
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, join, uploadAll, startGame } from "./helpers.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function startedGame(server, specs, instanceId) {
  const cs = await join(server, specs, instanceId);
  await uploadAll(cs);
  return startGame(cs);
}

const askerOf = (cs) => cs.find((c) => c.id === cs[0].state.turn.currentId);

// Everyone except the guesser votes the same way, and we wait for the guess to resolve.
async function guessAndVote(cs, asker, value) {
  asker.send({ type: "guessStart" });
  await asker.waitFor((s) => !!s.guess, "guess to open");
  for (const c of cs) if (c !== asker) c.send({ type: "vote", value });
  await asker.waitFor((s) => !s.guess, "guess to resolve");
}

test("guessing early is worth more than guessing late", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const cs = await startedGame(server, [["p1", "Ana"], ["p2", "Ben"], ["p3", "Cleo"], ["p4", "Dan"]], "score");

  const points = [];
  for (let i = 0; i < 4; i++) {
    const asker = askerOf(cs);
    if (!asker) break;
    await guessAndVote(cs, asker, true);
    const me = asker.state.players.find((p) => p.id === asker.id);
    points.push(me.lastPoints);
  }

  // four players: the first to solve scores 4, then 3, then 2, then 1
  assert.deepEqual(points, [4, 3, 2, 1],
    "points should fall as more players solve the round");
  const total = cs[0].state.players.reduce((n, p) => n + p.score, 0);
  assert.equal(total, 10);
  cs.forEach((c) => c.close());
});

test("three wrong guesses put a player out for the round", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const cs = await startedGame(server, [["o1", "Ana"], ["o2", "Ben"], ["o3", "Cleo"]], "out");

  const victim = askerOf(cs);
  for (let n = 1; n <= 3; n++) {
    // give the turn back to the victim if it moved on
    for (let i = 0; i < 4 && askerOf(cs) !== victim; i++) {
      const cur = askerOf(cs);
      if (!cur) break;
      cur.send({ type: "pass" });
      await wait(120);
    }
    if (askerOf(cs) !== victim) break;
    await guessAndVote(cs, victim, false);
    const me = victim.state.players.find((p) => p.id === victim.id);
    if (n < 3) {
      assert.equal(me.wrong, n, `wrong guesses should be counted (${n})`);
      assert.equal(me.status, "playing");
    } else {
      assert.equal(me.status, "out", "three wrong guesses should end the round for that player");
    }
  }
  const me = victim.state.players.find((p) => p.id === victim.id);
  assert.equal(me.status, "out");
  assert.equal(me.score, 0, "a player who is out should not have scored");

  // and the turn must not come back to them
  await wait(300);
  assert.notEqual(cs[0].state.turn.currentId, victim.id,
    "a player who is out must not be given the turn");
  cs.forEach((c) => c.close());
});

test("a player who is out is shown their own card", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const cs = await startedGame(server, [["x1", "Ana"], ["x2", "Ben"], ["x3", "Cleo"]], "outreveal");

  const victim = askerOf(cs);
  assert.equal(victim.shownFor(victim.id), null, "hidden while still guessing");
  for (let n = 0; n < 3; n++) {
    for (let i = 0; i < 4 && askerOf(cs) !== victim; i++) {
      askerOf(cs)?.send({ type: "pass" });
      await wait(120);
    }
    if (askerOf(cs) !== victim) break;
    await guessAndVote(cs, victim, false);
  }
  await victim.waitFor((s) => s.players.find((p) => p.id === victim.id).status === "out", "out");
  await victim.waitFor((s) => s.table.some((e) => e.holderId === victim.id), "own card revealed");
  const own = victim.shownFor(victim.id);
  assert.ok(own && own.image, "once out, the player should finally see what they were holding");
  cs.forEach((c) => c.close());
});

test("the game ends after three rounds and names a winner", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const cs = await startedGame(server, [["e1", "Ana"], ["e2", "Ben"]], "ending");
  const host = cs[0];

  for (let round = 1; round <= 3; round++) {
    assert.equal(host.state.round, round);
    for (let i = 0; i < 3 && !host.state.roundDone; i++) {
      const asker = askerOf(cs);
      if (!asker) break;
      await guessAndVote(cs, asker, true);
    }
    await host.waitFor((s) => s.roundDone, `round ${round} done`);
    host.send({ type: "nextRound" });
    if (round < 3) await host.waitFor((s) => s.round === round + 1, "next round");
  }

  for (const c of cs) await c.waitFor((s) => s.phase === "GAME_END", "game end");
  const ev = host.state.events.find((e) => e.type === "gameEnd");
  assert.ok(ev, "a gameEnd event should be sent");
  const top = Math.max(...host.state.players.map((p) => p.score));
  assert.deepEqual(
    [...ev.winnerIds].sort(),
    host.state.players.filter((p) => p.score === top).map((p) => p.id).sort(),
    "the winners are everyone on the top score");
  assert.equal(host.state.turn, null, "there is no turn once the game is over");
  assert.deepEqual(host.state.table, [], "and no cards left on the table");
  cs.forEach((c) => c.close());
});

test("a drawn game reports every player on the top score as a winner", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const cs = await startedGame(server, [["t1", "Ana"], ["t2", "Ben"]], "tie");
  const host = cs[0];

  // with two players the solver scores 2 and the other scores 1, each round, so
  // alternating who guesses first ends level.
  for (let round = 1; round <= 3; round++) {
    for (let i = 0; i < 3 && !host.state.roundDone; i++) {
      const asker = askerOf(cs);
      if (!asker) break;
      await guessAndVote(cs, asker, true);
    }
    await host.waitFor((s) => s.roundDone, "round done");
    host.send({ type: "nextRound" });
    if (round < 3) await host.waitFor((s) => s.round === round + 1, "next");
  }
  await host.waitFor((s) => s.phase === "GAME_END", "end");
  const ev = host.state.events.find((e) => e.type === "gameEnd");
  const top = Math.max(...host.state.players.map((p) => p.score));
  const onTop = host.state.players.filter((p) => p.score === top);
  assert.equal(ev.winnerIds.length, onTop.length,
    "every player on the top score is a winner, however many that is");
  cs.forEach((c) => c.close());
});

test("going back to the lobby clears scores and cards for a fresh game", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const cs = await startedGame(server, [["c1", "Ana"], ["c2", "Ben"]], "clear");
  const host = cs[0];

  const asker = askerOf(cs);
  await guessAndVote(cs, asker, true);
  assert.ok(host.state.players.some((p) => p.score > 0), "somebody scored");

  host.send({ type: "reset" });
  for (const c of cs) await c.waitFor((s) => s.phase === "LOBBY", "lobby");
  for (const p of host.state.players) {
    assert.equal(p.score, 0, "scores are cleared");
    assert.equal(p.uploaded, 0, "cards are cleared");
    assert.equal(p.status, "playing");
    assert.equal(p.wrong, 0);
    assert.deepEqual(p.hist, [0, 0, 0]);
  }
  assert.deepEqual(host.state.table, []);
  cs.forEach((c) => c.close());
});

test("a player's own card name is never sent to anyone else", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const cs = await join(server, [["s1", "Ana"], ["s2", "Ben"]], "slots");
  await uploadAll(cs);
  // "you.slots" carries the names of your own uploads; it must only ever be your own
  for (const c of cs) {
    assert.equal(c.state.you.id, c.id);
    assert.deepEqual(c.state.you.slots.map((x) => x.name),
      [`${c.name}-card1`, `${c.name}-card2`, `${c.name}-card3`],
      "a player sees the names of their own three cards");
    // and the roster must not carry anyone's card names
    const raw = JSON.stringify(c.state.players);
    for (const other of cs) {
      if (other === c) continue;
      assert.ok(!raw.includes(`${other.name}-card`),
        `${c.name} must not be told what ${other.name} uploaded`);
    }
  }
  cs.forEach((c) => c.close());
});
