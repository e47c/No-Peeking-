# Test report

Run everything with `npm test`. Chromium is needed once: `npx playwright install chromium`.

```
test:server   30 tests   pass
test:browser   1 test    pass   (two full games, three browser pages)
test:audio     2 tests   pass   (all 27 effects rendered and measured)
```

## What the automated tests cover

### The picture promise

This is the part that matters most, because the Privacy Policy and the Discord listing
both make a promise about it.

| Checked | How |
|---|---|
| Every dealt card shows the picture its owner uploaded | the rendered card's pixels are sampled in a real browser and compared with the colour that player uploaded for that round |
| You are never shown the card you are holding | the card is censored in the page, has no image, and its caption reads `???` |
| Your card is never even sent to your browser | every WebSocket frame the browser received is scanned, each picture in it is decoded, and the held card's picture must not be among them |
| You see your card once you solve it, or are out | the reveal is checked against the real owner's picture |
| Pictures are deleted when the round ends | read back out of the server's own memory |
| Pictures are gone when the last player leaves | the room and everything in it disappears |
| Nobody is told what anyone else uploaded | card names only ever appear in your own `you.slots` |

Three consecutive games, rematches, the same file uploaded twice, and a different file in
the same slot are all covered.

### Rules and scoring

Early guesses score more (4, 3, 2, 1 with four players); three wrong guesses put you out
for the round and the turn skips you; the game ends after three rounds; a draw reports
every player on the top score; going back to the lobby clears scores and cards.

### Edge cases

Twelve players deal as a clean permutation with nobody holding their own card, and the
thirteenth is turned away. A newcomer cannot join a game in progress. The host leaving
hands the role to someone still online. Reconnecting mid-game restores the table, the
pictures and the score. The same account in a second tab takes over and the first tab is
told. Rapid clicking cannot open two guesses, cannot pass while a guess is open, and
reacts are rate limited. The guesser's own vote does not count and voting twice counts
once. Only the host can start, advance a round or return to the lobby. A game cannot start
before everyone is ready, and one player alone cannot start at all.

Malformed uploads are all refused — oversized, PNG, SVG, a plain string, an empty string,
a number, `null`, broken base64 — and the refusal says which card it belongs to.

### Sound

All 27 effects, rendered offline through the real graph and measured:

- nothing peaks above 0.29 of full scale, against a 0.45 limit. That limit is no longer
  a clipping guard - it is a promise that nothing in the game ever shouts;
- the everyday effects span 3.6x in loudness, inside the 6x the test allows;
- interface feedback sits below the event sounds, which sit below the big moments. The
  loudest everyday sound measures 0.0288 and the quietest big moment 0.0373;
- the brightest effect puts 23% of its energy in the stinging range, against a 30% limit.

The whole set is roughly a third quieter than it was before the calm pass, and every
loudness band in the test moved down with it.

There is also a test proving the measurement hook only exists behind `?np_dev=`, so it is
not reachable in the Discord activity.

### Safety of the development login

There is a test that starts the server **without** `DEV_AUTH` and confirms that the fake
login is refused and the debug view returns 404. This is the configuration Render runs.

## What the tests cannot cover

### Sound — needs a person with headphones

Most of what used to be on this list is now measured. `npm run test:audio` renders all 27
effects through the real audio graph and checks that none clips, that each sits in the
loudness band its job implies, that the everyday sounds are within 6x of each other, that
the big moments really are the loudest thing in the game, and that nothing is harsh. It
prints the whole table, so a regression shows up as a number rather than as a complaint.

What is left genuinely needs ears and a real call:

- [ ] The set sounds like one instrument, not a pile of beeps
- [ ] Nothing is annoying on the tenth hearing — particularly `click`, `hover` and `tick`,
      which play constantly
- [ ] The round title sound lands exactly when the title slams in
- [ ] Music ducks under the big moments and comes back, rather than fighting them
- [ ] Music does not drown out people talking in the voice call. The pad is filtered at
      430 Hz specifically to sit under a speaking voice, but only a real call proves it
- [ ] The music can play for an hour without anyone asking for it to be turned off
- [ ] Mute, volume and the music switch all work, and are remembered after a reload
- [ ] Sound stops when you switch to another Discord channel and comes back when you return
- [ ] On a phone, the first tap starts the sound and nothing is blocked
- [ ] On laptop speakers (no bass), the low sounds — `thump`, `out`, `deny` — are still
      audible rather than disappearing entirely

### Discord itself — needs a real voice channel

The Activity cannot be launched outside Discord, so none of this is automatable.

- [ ] The Activity starts in a voice channel and reaches the menu
- [ ] It shows your real Discord name and avatar
- [ ] Two or more people in the same call land in the same game automatically
- [ ] The Terms and Privacy links open in a browser, not inside the iframe
- [ ] It works on the Discord **mobile** app, both portrait and landscape
- [ ] The action bar at the bottom is reachable on a phone and not cut off
- [ ] Leaving the call and coming back puts you back in the game with your score
- [ ] Closing the Activity and reopening it works
- [ ] Twelve people in one game is still usable on a phone screen
- [ ] A redeploy while a game is running ends it cleanly, with a clear message

### The free hosting plan

- [ ] Leave the game alone for an hour, then open it. It should say *"Waking the game
      server up… this can take up to a minute."* and then connect, rather than failing.
- [ ] `https://<your-render-url>/healthz` says `ok`

## Known gap

Pictures are deleted when the host moves to the next round. If the host walks away after a
round finishes, that round's pictures stay in server memory until everyone disconnects
(immediate) or the room expires (two hours). This is consistent with "deleted after each
round" for any game that is actually being played, but if you want a hard guarantee the
round could advance itself after a few idle minutes. That is a gameplay change, so it is
not done here.
