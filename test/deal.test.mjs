// TASK 1 - VERIFY FIRST. Plays real games end to end and checks that every dealt and
// revealed card carries the picture its owner actually uploaded, that nobody ever
// receives their own picture while still guessing, and that pictures leave server
// memory when the round ends.
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, join, uploadAll, picture, tagOf, startGame } from "./helpers.mjs";

const dbg = async (server) => (await fetch(server.base + "/__debug/rooms")).json();

// Every tile a tab can see must show its owner's real picture for the current round,
// and a player still guessing must never be sent their own.
function auditTable(c, round) {
  const s = c.state;
  const deal = new Map(s.table.map((t) => [t.holderId, t]));
  const mine = s.players.find((p) => p.id === c.id);

  if (mine.status === "playing") {
    assert.equal(deal.has(c.id), false,
      `${c.name} was sent their OWN card while still guessing - privacy leak`);
  }

  for (const [holderId, entry] of deal) {
    const shown = c.shownFor(holderId);
    assert.ok(shown.image, `${c.name} has no picture for ${holderId}'s tile`);
    const tag = tagOf(shown.image);
    assert.ok(tag, `${c.name}: picture for ${holderId} is not a decodable test picture`);
    // tag is "<ownerName>:<round>" - the caption must agree with the bytes
    const [ownerName, pictureRound] = tag.split(":");
    assert.equal(Number(pictureRound), round,
      `${c.name} sees a picture from round ${pictureRound} during round ${round} - STALE IMAGE`);
    assert.equal(entry.name, `${ownerName}-card${round}`,
      `${c.name}: caption "${entry.name}" does not match the picture bytes (${tag}) - MISMATCHED CARD`);
  }
  return deal;
}

// Drive one round to completion: each player in turn order guesses and everyone else
// votes yes, so every player solves and the round ends cleanly.
async function playRound(clients, round) {
  for (const c of clients) await c.waitFor((s) => s.phase === "ROUND" && s.round === round, `round ${round}`);
  for (const c of clients) auditTable(c, round);

  for (let guard = 0; guard < 40; guard++) {
    const any = clients[0].state;
    if (any.roundDone) break;
    const curId = any.turn?.currentId;
    if (!curId) break;
    const asker = clients.find((c) => c.id === curId);

    asker.send({ type: "guessStart" });
    await asker.waitFor((s) => !!s.guess, "guess to open");
    for (const c of clients) {
      if (c === asker) continue;
      c.send({ type: "vote", value: true });
    }
    await asker.waitFor((s) => !s.guess, "guess to resolve");
    await asker.waitFor((s) => s.players.find((p) => p.id === asker.id).status === "solved", "asker solved");

    // once solved, the asker is finally allowed to see their own picture
    const own = asker.shownFor(asker.id);
    assert.ok(own && own.image, `${asker.name} solved but never got their own picture revealed`);
    const [ownerName, pr] = tagOf(own.image).split(":");
    assert.equal(Number(pr), round, `${asker.name}'s revealed picture is from the wrong round`);
    assert.equal(own.name, `${ownerName}-card${round}`, `${asker.name}'s reveal caption does not match the bytes`);
  }

  for (const c of clients) await c.waitFor((s) => s.roundDone, `round ${round} to finish`);
}

test("three consecutive games: every dealt card shows the right picture", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());

  const specs = [["111", "Ana"], ["222", "Ben"], ["333", "Cleo"]];
  const clients = await join(server, specs);
  const host = clients[0];

  for (let game = 1; game <= 3; game++) {
    await t.test(`game ${game}`, async () => {
      for (const c of clients) await c.waitFor((s) => s.phase === "LOBBY", "lobby");
      await uploadAll(clients);

      await startGame(clients);

      for (let round = 1; round <= 3; round++) {
        await playRound(clients, round);

        // the pictures for the round just played must leave server memory
        const before = await dbg(server);
        const roomBefore = Object.values(before.rooms)[0];
        assert.ok(roomBefore.players.every((p) => p.cards[round - 1] !== null),
          `round ${round} pictures should still be held while the round is open`);

        host.send({ type: "nextRound" });
        if (round < 3) {
          for (const c of clients) await c.waitFor((s) => s.round === round + 1, `round ${round + 1}`);
        } else {
          for (const c of clients) await c.waitFor((s) => s.phase === "GAME_END", "game end");
        }

        const after = await dbg(server);
        const room = Object.values(after.rooms)[0];
        for (const p of room.players) {
          assert.equal(p.cards[round - 1], null,
            `player ${p.id} still holds the round ${round} picture in server memory after the round ended`);
        }
      }

      // at game end nothing is left
      const end = await dbg(server);
      const room = Object.values(end.rooms)[0];
      for (const p of room.players) {
        assert.deepEqual(p.cards, [null, null, null],
          `player ${p.id} still holds pictures after the game ended`);
      }

      host.send({ type: "reset" });
      for (const c of clients) await c.waitFor((s) => s.phase === "LOBBY", "back to lobby");
    });
  }

  for (const c of clients) c.close();
});

test("re-uploading the same picture and a different picture both deal correctly", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());

  const clients = await join(server, [["a1", "Ana"], ["b2", "Ben"]]);
  const [ana, ben] = clients;

  // Ana locks in, replaces slot 0 with the SAME bytes, then with DIFFERENT bytes.
  const same = picture("Ana:1");
  ana.send({ type: "upload", slot: 0, name: "Ana-card1", image: same });
  await ana.waitForMessage("uploaded");
  ana.send({ type: "upload", slot: 0, name: "Ana-card1", image: same });
  await ana.waitForMessage("uploaded");
  ana.send({ type: "upload", slot: 0, name: "Ana-card1", image: picture("Ana:1") });
  await ana.waitForMessage("uploaded");

  for (let i = 1; i < 3; i++) {
    ana.send({ type: "upload", slot: i, name: `Ana-card${i + 1}`, image: picture(`Ana:${i + 1}`) });
    await ana.waitForMessage("uploaded");
  }
  for (let i = 0; i < 3; i++) {
    ben.send({ type: "upload", slot: i, name: `Ben-card${i + 1}`, image: picture(`Ben:${i + 1}`) });
    await ben.waitForMessage("uploaded");
  }
  for (const c of clients) await c.waitFor((s) => s.players.every((p) => p.uploaded === 3), "all in");

  ana.send({ type: "start" });
  for (const c of clients) await c.waitFor((s) => s.phase === "ROUND", "start");

  // The card above Ana's head was uploaded by Ben and is hidden from her; the card above
  // Ben's head was uploaded by Ana, so Ana can see it (she chose it) and Ben cannot.
  const anaSeesOnBen = ana.shownFor(ben.id);
  const benSeesOnAna = ben.shownFor(ana.id);
  assert.equal(tagOf(anaSeesOnBen.image), "Ana:1", "Ana should see her own upload above Ben's head");
  assert.equal(anaSeesOnBen.name, "Ana-card1");
  assert.equal(tagOf(benSeesOnAna.image), "Ben:1", "Ben should see his own upload above Ana's head");
  assert.equal(benSeesOnAna.name, "Ben-card1");
  assert.equal(ana.shownFor(ana.id), null, "Ana must not be sent her own card");
  assert.equal(ben.shownFor(ben.id), null, "Ben must not be sent his own card");

  for (const c of clients) c.close();
});
