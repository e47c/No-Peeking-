// A tool, not a test. Plays a whole game and screenshots every screen at a desktop size
// and a phone size, so a design change can be looked at without going into Discord.
//
//   npm run screenshots            -> writes into ./screenshots
//   OUT=/some/where npm run screenshots
//
// Run "npm run build" first if you changed anything in src/.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { startServer } from "./helpers.mjs";

const SP = process.env.OUT || process.env.SP || path.join(process.cwd(), "screenshots");
fs.mkdirSync(SP, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = { desktop: { width: 1180, height: 860 }, phone: { width: 390, height: 780 } };
const NAMES = [["a1", "Ana"], ["b2", "Ben"], ["c3", "Cleo"]];

const server = await startServer();
const browser = await chromium.launch();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "np-shots-"));

for (const [sizeName, viewport] of Object.entries(SIZES)) {
  const room = "shots-" + sizeName + "-" + Date.now();
  const ps = [];
  for (const [id, name] of NAMES) {
    const ctx = await browser.newContext({ viewport });
    ctx.setDefaultTimeout(20000);
    const page = await ctx.newPage();
    await page.goto(`${server.base}/?np_dev=${name}&np_id=${id}&np_room=${room}`);
    await page.locator("#playBtn").waitFor();
    ps.push({ id, name, page, ctx });
  }
  const shot = (p, label) => p.page.screenshot({ path: `${SP}/${sizeName}-${label}.png` });

  await sleep(900);
  await shot(ps[0], "01-menu");
  await ps[0].page.locator("#howBtn").click();
  await sleep(500);
  await shot(ps[0], "02-howtoplay");
  await ps[0].page.locator("#dlgHow button.btn.primary").click();
  await sleep(400);
  await ps[0].page.locator("#setBtn").click();
  await sleep(500);
  await shot(ps[0], "03-settings");
  await ps[0].page.locator("#dlgSettings button.btn.primary").click();
  await sleep(400);

  for (const p of ps) {
    await p.page.locator("#playBtn").click();
    await p.page.locator("#screen-lobby").waitFor({ state: "visible" });
  }
  await sleep(700);
  await shot(ps[0], "04-lobby-empty");

  const du = await ps[0].page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 300; c.height = 300;
    const g = c.getContext("2d");
    g.fillStyle = "#2b6cb0"; g.fillRect(0, 0, 300, 300);
    g.fillStyle = "#fff"; g.font = "bold 40px sans-serif"; g.fillText("PIC", 95, 165);
    return c.toDataURL("image/jpeg", 0.9);
  });
  const file = path.join(dir, "p.jpg");
  fs.writeFileSync(file, Buffer.from(du.split(",")[1], "base64"));

  const fr0 = ps[0].page.locator("#slots .frame").nth(0);
  await fr0.locator("input[type=file]").setInputFiles(file);
  await fr0.locator(".drop img").waitFor({ state: "visible" });
  await sleep(400);
  await shot(ps[0], "05-lobby-picked-not-locked");

  for (const p of ps) {
    for (let r = 0; r < 3; r++) {
      const fr = p.page.locator("#slots .frame").nth(r);
      await fr.locator("input[type=file]").setInputFiles(file);
      await fr.locator(".drop img").waitFor({ state: "visible" });
      await fr.locator(".caption-in").fill(`${p.name}-card${r + 1}`);
      await fr.locator("button.btn").click();
      await fr.locator(".msg").filter({ hasText: "Locked in" }).waitFor();
    }
  }
  await sleep(500);
  await shot(ps[0], "06-lobby-ready");

  const hostIdx = await ps[0].page.evaluate(() =>
    [...document.querySelectorAll("#roster li")].findIndex((li) => li.querySelector(".role").textContent.includes("HOST")));
  const host = ps[hostIdx] ?? ps[0];
  await host.page.locator("#startBtn").click();
  for (const p of ps) await p.page.locator("#screen-game").waitFor({ state: "visible" });
  await sleep(900);
  await shot(ps[0], "07-deal-animation");
  await sleep(3500);

  const curId = await ps[0].page.evaluate(() => document.querySelector("#table .polaroid.asking")?.dataset.player);
  const asker = ps.find((p) => p.id === curId) ?? ps[0];
  const other = ps.find((p) => p !== asker);
  await shot(asker, "08-table-your-turn");
  await shot(other, "09-table-their-turn");

  await asker.page.getByRole("button", { name: "I know it!" }).click();
  await sleep(900);
  await shot(asker, "10-guess-guesser");
  await shot(other, "11-guess-voter");

  for (const p of ps) if (p !== asker) await p.page.getByRole("button", { name: /Correct/ }).click();
  await sleep(1500);
  await shot(asker, "12-after-correct");

  const finishRound = async () => {
    for (let g = 0; g < 10; g++) {
      const done = await ps[0].page.evaluate(() => document.querySelector("#dockTitle")?.textContent.includes("Round complete"));
      if (done) return;
      const cur = await ps[0].page.evaluate(() => document.querySelector("#table .polaroid.asking")?.dataset.player);
      if (!cur) return;
      const a2 = ps.find((p) => p.id === cur);
      await a2.page.getByRole("button", { name: "I know it!" }).click().catch(() => {});
      for (const p of ps) if (p !== a2) await p.page.getByRole("button", { name: /Correct/ }).click().catch(() => {});
      await sleep(900);
    }
  };
  await finishRound();
  await sleep(600);
  await shot(ps[0], "13-round-complete");

  for (let round = 2; round <= 3; round++) {
    await host.page.getByRole("button", { name: "Next round" }).click().catch(() => {});
    await sleep(4300);
    await finishRound();
    await sleep(400);
  }
  await host.page.getByRole("button", { name: "Final results" }).click().catch(() => {});
  await sleep(1100);
  await shot(ps[0], "14-winner-suspense");
  await sleep(2400);
  await shot(ps[0], "15-winner-card");
  await sleep(4500);
  await shot(ps[0], "16-winner-full");

  for (const p of ps) await p.ctx.close();
  console.log("done: " + sizeName);
}
await browser.close();
await server.stop();
console.log("screenshots written to " + SP);
