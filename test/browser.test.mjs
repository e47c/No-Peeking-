// TASK 1 - the game played in a real browser, one page per player.
//
// This is the test the previous pass never had. It checks what only a browser can show:
// that the picture drawn on each card really is the picture its owner uploaded (by
// sampling the pixels), that a player's own card is censored in the page, and that their
// own picture is never even sent to their browser while they are still guessing.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startServer } from "./helpers.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// The server serves the built page, so build it here. A placeholder client id is enough:
// this test signs in through DEV_AUTH and never talks to Discord.
function buildTheGame() {
  execFileSync(process.execPath, [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "build"], {
    cwd: ROOT,
    env: { ...process.env, VITE_CLIENT_ID: process.env.VITE_CLIENT_ID || "000000000000000000" },
    stdio: "pipe",
  });
}

// Each player gets an unmistakable colour per round, so a card showing the wrong picture
// cannot hide behind JPEG compression.
const PLAYERS = [
  { id: "a1", name: "Ana", colours: [[255, 0, 0], [255, 255, 0], [255, 0, 255]] },
  { id: "b2", name: "Ben", colours: [[0, 200, 0], [0, 255, 255], [140, 255, 0]] },
  { id: "c3", name: "Cleo", colours: [[0, 0, 255], [255, 130, 0], [0, 130, 255]] },
];

const near = (a, b, tol = 46) => !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) <= tol);
const show = (c) => (c ? `rgb(${c.join(",")})` : "nothing");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, label, ms = 25000) {
  const deadline = Date.now() + ms;
  let last;
  for (;;) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e.message; }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label} (last: ${JSON.stringify(last)})`);
    await sleep(120);
  }
}

// Real JPEG files, made by a browser canvas so they are genuinely valid images.
async function makePictures(page, dir) {
  const files = {};
  for (const p of PLAYERS) {
    for (let r = 0; r < 3; r++) {
      const dataUrl = await page.evaluate((rgb) => {
        const c = document.createElement("canvas");
        c.width = 420; c.height = 420;
        const g = c.getContext("2d");
        g.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        g.fillRect(0, 0, c.width, c.height);
        return c.toDataURL("image/jpeg", 0.95);
      }, p.colours[r]);
      const file = path.join(dir, `${p.name}-${r + 1}.jpg`);
      fs.writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
      files[`${p.name}:${r + 1}`] = file;
    }
  }
  return files;
}

// The colour actually painted on one player's card, read back off the rendered <img>.
const cardColour = (page, playerId) => page.evaluate((id) => {
  const img = document.querySelector(`#table .polaroid[data-player="${id}"] .photo img`);
  if (!img || !img.getAttribute("src") || img.classList.contains("hidden")) return null;
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  if (!c.width || !c.height) return null;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const d = g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
  return [d[0], d[1], d[2]];
}, playerId);

// Decode a batch of data URLs in the page and report the centre colour of each.
const coloursOf = (page, urls) => page.evaluate(async (list) => {
  const out = [];
  for (const u of list) {
    const colour = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        if (!c.width) return resolve(null);
        const g = c.getContext("2d");
        g.drawImage(img, 0, 0);
        const d = g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
        resolve([d[0], d[1], d[2]]);
      };
      img.onerror = () => resolve(null);
      setTimeout(() => resolve(null), 4000); // never let one bad picture stall the test
      img.src = u;
    });
    if (colour) out.push(colour);
  }
  return out;
}, urls);

async function openPlayer(browser, server, player, room) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  ctx.setDefaultTimeout(20000);
  const page = await ctx.newPage();
  const received = [];
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("websocket", (ws) => {
    ws.on("framereceived", (f) => {
      received.push(typeof f.payload === "string" ? f.payload : f.payload.toString("utf8"));
    });
  });
  await page.goto(`${server.base}/?np_dev=${player.name}&np_id=${player.id}&np_room=${room}`);
  await until(async () => !(await page.locator("#playBtn").isDisabled()), `${player.name}'s Play button`);
  return {
    ...player, page, ctx, errors, received,
    // A player is legitimately shown the card they were holding once they solve it, so
    // the privacy check has to look only at what arrived during the current round.
    mark: 0,
    markNow() { this.mark = received.length; },
    pictures(from = 0) {
      const found = new Set();
      for (const frame of received.slice(from)) {
        for (const m of frame.matchAll(/data:image\/jpeg;base64,[A-Za-z0-9+/=]+/g)) found.add(m[0]);
      }
      return [...found];
    },
  };
}

async function lockInCards(p, files) {
  for (let r = 0; r < 3; r++) {
    const frame = p.page.locator("#slots .frame").nth(r);
    await frame.locator("input[type=file]").setInputFiles(files[`${p.name}:${r + 1}`]);
    await until(() => frame.locator(".drop img").isVisible(), `${p.name}'s picture ${r + 1} preview`);
    await frame.locator(".caption-in").fill(`${p.name}-card${r + 1}`);
    await frame.locator("button.btn").click();
    await until(async () => /Locked in/.test(await frame.locator(".msg").textContent()),
      `${p.name}'s card ${r + 1} to lock in`);
  }
}

const dockTitle = (p) => p.page.locator("#dockTitle").textContent();
const askerId = (p) => p.page.evaluate(() =>
  document.querySelector("#table .polaroid.asking")?.dataset.player ?? null);

test("a whole game in a real browser, then a rematch, shows every card correctly", async (t) => {
  buildTheGame();
  const server = await startServer();
  const browser = await chromium.launch();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "np-browser-"));
  t.after(async () => { await browser.close(); await server.stop(); });

  const room = "browser-" + Date.now();
  const players = [];
  for (const p of PLAYERS) players.push(await openPlayer(browser, server, p, room));
  const ana = players[0];
  const files = await makePictures(ana.page, dir);

  for (const p of players) {
    await p.page.locator("#playBtn").click();
    await until(() => p.page.locator("#screen-lobby").isVisible(), `${p.name} in the lobby`);
  }
  for (const p of players) {
    await until(async () => (await p.page.locator("#castCount").textContent()) === "3",
      `${p.name} to see all three players`);
  }

  // whoever the lobby marks as HOST drives the game
  const hostIndex = await ana.page.evaluate(() =>
    [...document.querySelectorAll("#roster li")].findIndex((li) => li.querySelector(".role").textContent.includes("HOST")));
  const host = players[hostIndex] ?? ana;

  for (let game = 1; game <= 2; game++) {
    {
      console.log(`  game ${game}: locking in cards`);
      for (const p of players) await lockInCards(p, files);
      await until(async () => !(await host.page.locator("#startBtn").isDisabled()), "the start button");
      for (const p of players) p.markNow(); // only judge pictures sent from here on
      await host.page.locator("#startBtn").click();

      for (let round = 1; round <= 3; round++) {
        {
          console.log(`  game ${game} round ${round}`);
          for (const p of players) {
            await until(() => p.page.locator("#screen-game").isVisible(), `${p.name} at the table`);
            await until(async () =>
              (await p.page.locator("#roundLights").getAttribute("aria-label")) === `Round ${round} of 3`,
              `${p.name} to reach round ${round}`);
            // the deal animation has to finish putting pictures down
            await until(async () =>
              (await p.page.locator("#table .polaroid .photo img:not(.hidden)").count()) === players.length - 1,
              `${p.name} to be dealt ${players.length - 1} cards`);
          }

          // Each player's own view of the table. A player's own tile reads "???" to them
          // but shows the real caption to everyone else, so each view has to be read from
          // the page that owns it.
          const tables = {};
          for (const p of players) {
            tables[p.id] = await p.page.evaluate(() =>
              [...document.querySelectorAll("#table .polaroid")].map((el) => ({
                player: el.dataset.player,
                caption: el.querySelector(".caption").textContent,
              })));
          }

          // who really owns the card each player is holding - the one thing they must not see
          const secretOwnerOf = {};
          for (const viewer of players) {
            const witness = players.find((p) => p.id !== viewer.id);
            const caption = tables[witness.id].find((x) => x.player === viewer.id).caption;
            secretOwnerOf[viewer.id] = PLAYERS.find((q) => caption.startsWith(q.name + "-card"));
          }

          for (const viewer of players) {
            const mine = tables[viewer.id];

            // 1. the viewer's own card is censored, unlabelled, and carries no picture
            const own = viewer.page.locator(`#table .polaroid[data-player="${viewer.id}"]`);
            assert.match(await own.getAttribute("class"), /\bmine\b/,
              `${viewer.name}'s own card should be marked as theirs`);
            assert.equal(await own.locator(".censor").isVisible(), true,
              `${viewer.name}'s own card should be covered by the censor bar`);
            assert.equal(await cardColour(viewer.page, viewer.id), null,
              `${viewer.name} can see the card they are holding - privacy leak`);
            assert.equal(mine.find((x) => x.player === viewer.id).caption, "???",
              `${viewer.name} must not be told the name of the card they are holding`);

            // 2. every other card shows exactly the picture its owner uploaded
            for (const other of players) {
              if (other.id === viewer.id) continue;
              const caption = mine.find((x) => x.player === other.id).caption;
              const owner = PLAYERS.find((q) => caption.startsWith(q.name + "-card"));
              assert.ok(owner, `caption "${caption}" names no known player`);
              assert.equal(caption, `${owner.name}-card${round}`,
                `the caption on ${other.name}'s card should be this round's`);
              const expected = owner.colours[round - 1];
              const actual = await cardColour(viewer.page, other.id);
              assert.ok(near(actual, expected),
                `${viewer.name} sees ${show(actual)} on ${other.name}'s card, but ${caption} was uploaded as ${show(expected)}`);
            }

            // 3. The picture on the viewer's own tile belongs to another player, and is
            //    the one secret of the round. It must never reach the viewer's browser at
            //    all - not just be hidden in the page. Any other page can tell us whose
            //    card it is.
            const secretOwner = secretOwnerOf[viewer.id];
            assert.ok(secretOwner, `the card held by ${viewer.name} names no known player`);
            const secretCaption = `${secretOwner.name}-card${round}`;
            const secret = secretOwner.colours[round - 1];
            const got = await coloursOf(viewer.page, viewer.pictures(viewer.mark));
            assert.equal(got.some((c) => near(c, secret)), false,
              `${viewer.name} is holding ${secretCaption} and its picture ${show(secret)} was sent to their browser - privacy leak`);
          }

          // everyone guesses in turn until the round is complete
          for (let guard = 0; guard < 12; guard++) {
            if (/Round complete/.test(await dockTitle(ana))) break;
            const cur = await askerId(ana);
            if (!cur) break;
            const asker = players.find((p) => p.id === cur);
            await asker.page.getByRole("button", { name: "I know it!" }).click();
            for (const p of players) {
              if (p.id === cur) continue;
              await until(() => p.page.getByRole("button", { name: /Correct/ }).isVisible(), `${p.name}'s vote buttons`);
              await p.page.getByRole("button", { name: /Correct/ }).click();
            }
            const tile = asker.page.locator(`#table .polaroid[data-player="${cur}"]`);
            await until(async () => /\bsolved\b/.test(await tile.getAttribute("class")), `${asker.name} to solve`);
            // Once solved, the player is finally shown the card they were holding - which
            // belongs to another player, not their own upload.
            await until(async () => /\brevealed\b/.test(await tile.getAttribute("class")), `${asker.name}'s reveal`);
            const owner = secretOwnerOf[cur];
            const expected = owner.colours[round - 1];
            const revealed = await cardColour(asker.page, cur);
            assert.ok(near(revealed, expected),
              `${asker.name} solved: the reveal should show ${owner.name}'s card ${show(expected)} but showed ${show(revealed)}`);
          }

          for (const p of players) {
            await until(async () => /Round complete/.test(await dockTitle(p)), `${p.name} to finish round ${round}`);
          }
          for (const p of players) p.markNow(); // the next round's pictures start here
          await host.page.getByRole("button", { name: round >= 3 ? "Final results" : "Next round" }).click();
        }
      }

      // the winner screen
      for (const p of players) {
        await until(() => p.page.locator("#screen-results").isVisible(), `${p.name} at the results`);
      }
      await until(() => host.page.locator("#winnerCard").isVisible(), "the winner card");
      assert.ok((await host.page.locator("#winName").textContent()).trim().length > 0, "the winner should be named");
      assert.equal(await host.page.locator("#standings li").count(), 3, "every player appears in the standings");

      // Skip must bring the whole board in at once
      if (await host.page.locator("#skipBtn").isVisible()) await host.page.locator("#skipBtn").click();
      for (const id of ["standings", "resultActions", "boardTitle"]) {
        await until(async () => !/\bpre\b/.test(await host.page.locator("#" + id).getAttribute("class")),
          `#${id} to be shown after Skip`);
      }

      if (game === 1) {
        await host.page.getByRole("button", { name: "Play again" }).click();
        for (const p of players) {
          await until(() => p.page.locator("#screen-lobby").isVisible(), `${p.name} back in the lobby`);
          assert.equal(await p.page.locator("#slots .frame.locked").count(), 0,
            `${p.name} should start the rematch with three empty cards`);
        }
      }
    }
  }

  for (const p of players) {
    assert.deepEqual(p.errors, [], `${p.name}'s browser logged errors`);
  }
});
