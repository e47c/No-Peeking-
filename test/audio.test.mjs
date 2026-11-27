// The sound effects, measured.
//
// Whether a sound is *nice* needs ears, and the manual checklist in TEST-REPORT.md covers
// that. But three of the things the brief asks for are numbers, and numbers can be
// checked every time the suite runs:
//
//   - nothing clips or jumps out at the listener;
//   - the set is balanced, so no effect is wildly louder than its neighbours;
//   - nothing is harsh, measured as the share of energy in the stinging range.
//
// Each effect is rendered through the real audio graph - the same voices, the same room,
// the same master chain the game uses - in an OfflineAudioContext, and the rendered
// samples are measured. Nothing here is mocked.
import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startServer, buildTheGame } from "./helpers.mjs";

// What each effect is *for*. A hover whisper and a victory fanfare should not be held to
// the same loudness, but each should stay inside the band its own job implies.
//
//   whisper - interface feedback, heard dozens of times a minute
//   normal  - something happened
//   bed     - sustained tension that plays while people are talking over it
//   big     - the moments the game is built around
const TIER = {
  hover: "whisper", tick: "whisper", click: "whisper", turn: "whisper",
  guess: "bed", drumroll: "bed",
  play: "big", intro: "big", correct: "big", win: "big",
};
const tierOf = (n) => TIER[n] || "normal";

// Bands on short-term loudness (the loudest 300 ms), not on peak. Peak says how close a
// sound is to clipping; it says almost nothing about how loud it feels, because a lone
// low sine peaks high while a dense chord of the same loudness does not.
// Rescaled when the set was rebuilt to be calm. Every band moved down together, so the
// relationships below - whisper under normal under big - still carry their meaning; the
// whole game is simply quieter than it was, which is the point.
const BAND = {
  // tier      quietest  loudest
  whisper: [0.0005, 0.0075],
  normal: [0.0040, 0.0340],
  bed: [0.0120, 0.0300],
  big: [0.0340, 0.0750],
};

// How long each effect is allowed to run for. Short feedback must not drone, and the
// pieces timed against an animation must still line up with it.
const LENGTH = {
  hover: [0.01, 0.4], click: [0.01, 0.5], tick: [0.01, 0.4], turn: [0.05, 1.2],
  intro: [1.2, 5], win: [2.5, 8], drumroll: [1.5, 5], guess: [0.8, 4],
};

test("every sound effect is present, balanced and free of harshness", async (t) => {
  buildTheGame();
  const server = await startServer();
  t.after(() => server.stop());
  const browser = await chromium.launch();
  t.after(() => browser.close());

  const page = await browser.newPage();
  await page.goto(`${server.base}/?np_dev=Meter&np_id=meter&np_room=audio-room`);
  await page.waitForFunction(() => !!window.__npAudio, null, { timeout: 30000 });

  const names = await page.evaluate(() => window.__npAudio.sfxNames);
  assert.ok(names.length >= 27, `expected the full set of effects, got ${names.length}`);

  const rows = [];
  for (const name of names) {
    // `deal` and `react` take an argument; the defaults cover the rest.
    const arg = name === "deal" ? 3 : name === "react" ? "yes" : name === "thud" ? 1 : undefined;
    const m = await page.evaluate(
      ([n, a]) => window.__npAudio.measureSfx(n, 8, a),
      [name, arg]
    );
    assert.ok(m, `${name} could not be rendered`);
    rows.push(m);
  }

  const pad = (s, n) => String(s).padEnd(n);
  const num = (v, d = 4) => v.toFixed(d).padStart(d + 3);
  console.log(`\n  ${pad("effect", 11)}${pad("tier", 9)}  peak   loud300   rms      HF    seconds`);
  for (const r of rows) {
    console.log(`  ${pad(r.name, 11)}${pad(tierOf(r.name), 9)}${num(r.peak)}  ${num(r.loudest)}  ${num(r.activeRms)}  ${num(r.hfRatio, 3)}  ${num(r.seconds, 2)}`);
  }
  console.log("");

  for (const r of rows) {
    // 1. Something actually came out.
    assert.ok(r.activeRms > 0.0005, `${r.name} is silent (rms ${r.activeRms})`);
    assert.ok(r.seconds > 0.01, `${r.name} has no length (${r.seconds}s)`);

    // 2. Nothing clips. The master chain ends in a limiter and a 0.9 ceiling, so a peak
    //    at or above 1.0 would mean something has gone wrong with it.
    //    A calm set should not come near the ceiling at all. 0.45 is no longer a
    //    clipping guard; it is a promise that nothing in the game ever shouts.
    assert.ok(r.peak < 0.45, `${r.name} peaks at ${r.peak.toFixed(3)} - too loud for a calm set`);

    // 3. Loudness matches what the sound is for.
    const tier = tierOf(r.name);
    const [lo, hi] = BAND[tier];
    assert.ok(r.loudest >= lo, `${r.name} (${tier}) is too quiet to hear: ${r.loudest.toFixed(5)} < ${lo}`);
    assert.ok(r.loudest <= hi, `${r.name} (${tier}) is too loud: ${r.loudest.toFixed(5)} > ${hi}`);

    // 4. Nothing is harsh. Every noise voice runs through a lowpass ceiling, so the share
    //    of energy above roughly 6 kHz should stay modest. The measure is a ratio rather
    //    than an absolute, because a sound that is meant to be three times louder than
    //    the rest carries three times the energy everywhere, high end included - that is
    //    loudness, not harshness, and loudness is checked above. For scale: a pure mid
    //    tone lands near 0.02 and unfiltered white noise near 0.65. The limit came down
    //    from a third to under 0.3 when every voice gained a lower brightness ceiling.
    assert.ok(r.hfRatio < 0.3,
      `${r.name} is harsh: ${(r.hfRatio * 100).toFixed(1)}% of its energy is in the stinging range`);

    // 5. Length is appropriate.
    const len = LENGTH[r.name];
    if (len) {
      assert.ok(r.seconds >= len[0] && r.seconds <= len[1],
        `${r.name} lasts ${r.seconds.toFixed(2)}s, outside ${len[0]}-${len[1]}s`);
    } else {
      assert.ok(r.seconds <= 5, `${r.name} drones on for ${r.seconds.toFixed(2)}s`);
    }
  }

  // 6. The everyday sounds sit together. If one of them is six times louder than another
  //    it will be the only one anybody notices.
  const normal = rows.filter((r) => tierOf(r.name) === "normal").map((r) => r.loudest);
  const spread = Math.max(...normal) / Math.min(...normal);
  assert.ok(spread <= 6, `the everyday effects are ${spread.toFixed(1)}x apart in level - too uneven`);

  // 7. The quiet feedback really is quieter than the fanfares, which is the whole point
  //    of having tiers.
  const loudestIn = (tier) => Math.max(...rows.filter((r) => tierOf(r.name) === tier).map((r) => r.loudest));
  const quietestIn = (tier) => Math.min(...rows.filter((r) => tierOf(r.name) === tier).map((r) => r.loudest));
  assert.ok(loudestIn("whisper") < quietestIn("normal"),
    `interface feedback (${loudestIn("whisper").toFixed(4)}) should sit under the event sounds (${quietestIn("normal").toFixed(4)})`);
  assert.ok(loudestIn("normal") < quietestIn("big"),
    `the big moments (${quietestIn("big").toFixed(4)}) should be the loudest thing in the game, but an event sound reached ${loudestIn("normal").toFixed(4)}`);
});

test("the dev-only measurement hook is not reachable in the real game", async (t) => {
  buildTheGame();
  const server = await startServer();
  t.after(() => server.stop());
  const browser = await chromium.launch();
  t.after(() => browser.close());

  const page = await browser.newPage();
  // No ?np_dev=, so the page takes the Discord branch and never installs the hook.
  await page.goto(`${server.base}/`);
  await page.waitForTimeout(1500);
  const present = await page.evaluate(() => !!window.__npAudio);
  assert.equal(present, false, "the audio measurement hook must only exist behind ?np_dev=");
});
