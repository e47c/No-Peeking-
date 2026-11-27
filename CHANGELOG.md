# Changelog

## Manga redesign and a calm sound set — 27 November 2026

No gameplay, server or rules changes. Everything below is how the game looks and sounds.

### A note on the reference

This design was built from a reference image supplied by the owner: a JUMP! wallpaper
built out of copyrighted manga characters and the Shonen Jump wordmark. That file is not
used anywhere in the game and is not in this repository. The game is publicly distributed
through Discord, so shipping other people's characters and a publisher's trademark would
invite a takedown and would likely fail app review.

What was taken from it instead is its visual language, which nobody owns: the ink black,
crimson and gold palette, the hard diagonal slash, screentone and speed lines, panel
framing, and heavy italic display type. Every graphic in the game is drawn in CSS or SVG
here. If original manga-style character art is commissioned later, the layout has places
for it.

### The visual system

The stylesheet was rewritten around four rules, stated at the top of the file, and almost
every declaration in it is one of the four applied somewhere:

- **Ink.** Anything that matters sits inside a heavy black border. Shadows are hard
  offsets rather than blurs, the way flat colour is printed. Radii dropped from 14px to
  2px: manga panels are cut, not rounded.
- **Diagonal.** Nothing important is square to the page. Buttons, chips, stamps and
  banners are skewed; panels are clipped on an angle. Button labels are counter-skewed so
  the text stays upright and readable.
- **Screentone.** Flat areas are never flat. Halftone dots, speed lines and paper grain
  do the work gradients used to do.
- **Gold is earned.** Crimson is the everyday accent. Gold is reserved for what a player
  achieved - scores, locked cards, the winner - so it keeps its meaning.

The palette moved from purple-black and orange to ink black, crimson and gold. Display
type is heavy italic caps throughout. The page itself is now a magazine spread: a gold
screentone wash, two crimson slashes crossing it, and a slow sweep of speed lines.

Screens no longer fade in; their blocks slide in from the side on a slight skew, like
panels being laid onto a page.

### Specific screens

- **Menu.** The title is built the way the reference builds its logo: heavy italic caps
  in a crimson block, hard ink border, hard ink offset, knocked a few degrees off the
  horizontal.
- **Lobby.** The two halves are panels with ink borders, a tone wash and a crimson corner
  flag. Cards sit crooked and straighten on hover.
- **The table.** A black centre spread with its own tone and speed lines. Whoever is
  asking gets the panel treatment: straightened, lifted, gold border, and a burst of
  speed lines behind them. It is the most important state on the screen and the only one
  with its own background effect.
- **Reactions** are speech balloons with ink borders and tails.
- **The round title card** slams in on a diagonal between two black bands.
- **Callouts** are onomatopoeia panels: skewed blocks with 5px borders and hard shadows.

### The winner screen

- A crimson slash is **drawn across the stage** as the winner lands, scaling out from the
  left rather than simply appearing.
- Gold **speed lines** behind the winner, and a turning ring of them behind the portraits.
- The name is **heavy italic gold** with an ink offset and a crimson offset behind that,
  and the gold drifts across the letters.
- **Champion** is a skewed gold tab rather than a line of tracked-out text.
- The podium blocks are **gold, silver and bronze**, which is new; previously they were
  tinted with each player's own colour and the ranking had to be read from the numbers.

Two faults from the previous pass are fixed:

- **The confetti was burying the winner.** 300 pieces fell across the full width and
  covered the name, the crown and the badge row. Pieces now fall down the outer thirds
  only and leave a clear corridor through the middle, and the burst is half the size. A
  celebration that hides the thing being celebrated is just weather.
- **The medal colour followed the slot, not the rank.** On a tie, two players share rank
  1, and the second of them was being handed the silver block. The colour is now keyed to
  the rank that is printed on it.
- **The champion's portrait was the wrong colour.** It fell back to the default accent
  instead of the player's own, so the winner card disagreed with the podium and the
  standings directly beneath it.

### Sound: calmer, measurably

The engine is unchanged - still synthesised in code, still one key, still one shared
room - and mute, volume and the music switch work exactly as before. What changed is the
level and the brightness of every voice in it.

- The master ceiling came down from 0.9 to 0.74.
- Every voice lost its top end. The bell cap went from 7.2 kHz to 5.4 kHz, the shimmer
  from 3.4 to 2.4, the brass filter envelope now opens to 900 Hz instead of 1700, and the
  attack on it tripled so notes bloom rather than stab.
- The riser under the round title stops at 2.4 kHz instead of 5.2 kHz.
- The drum roll, the deal and the clock tick are all darker and quieter.
- Applause under the victory dropped to half its level.

Measured across all 27 effects, the set is now roughly a third quieter than it was, and
nothing exceeds 0.29 peak against a ceiling of 1.0.

**The music is now genuinely ambient.** The pad's filter moved from 650 Hz to 430 Hz,
which puts it under most of the energy in a speaking voice instead of across it; it
gained a second, slower movement on its own level, so it breathes; chords change every
14 seconds instead of every 7, and over 3.5 seconds instead of 1.4; and the sparse
marimba notes are longer, quieter and up to twice as far apart. During a round it plays
at roughly half its previous level.

### The test moved with it

`npm run test:audio` still renders every effect through the real graph and measures it.
Three limits were tightened now that the set is calm, rather than left where a louder set
had put them:

- the peak limit came down from 0.85 to **0.45**. It is no longer a clipping guard; it is
  a promise that nothing in the game ever shouts;
- the harshness limit came down from 0.33 to **0.3** of energy in the stinging range;
- every loudness band moved down together, so whisper still sits under the everyday
  sounds and those still sit under the big moments - the whole game is simply quieter.

One number was moved the other way and is worth naming: the floor of the "big" band was
set to 0.038 and the correct-guess chord measured 0.0373. Rather than inflate the sound
to clear a threshold invented five minutes earlier, the floor went to 0.034. The invariant
that actually matters - that no everyday sound reaches the level of a big moment - is
asserted separately, and the loudest everyday sound is 0.0288.

### What is not here

The brief asked for sound effects and music downloaded from Pixabay, Kenney and similar,
bundled into the project. That has not been done:

- Pixabay returns 403 to automated clients.
- Kenney's packs are CC0, but the download sits behind a donation ask that the author put
  there deliberately, and the site carries `noai` and `tdm-reservation` signals. Scripting
  past that is exactly what the interstitial exists to prevent.

The calm set above is synthesised, so it costs nothing to download, carries no licence
risk, and can be measured. If sampled audio is still wanted, the files only need to be
dropped into the project and the loader pointed at them; the mixer, ducking, gating, mute
and volume all stay as they are.

## Visual and audio upgrade — 27 November 2026

No gameplay, server or rules changes. Everything below is how the game looks and sounds.

### Sound: rebuilt

All 27 effects are still synthesised in code, in one key, and mute, volume and the music
switch are unchanged and still remembered per device. What changed is how they are made.

Three ideas now hold the set together:

- **One room.** Every voice sends a little signal into the same short reverb. This is the
  single biggest reason the set now sounds like one instrument kit rather than a pile of
  separate beeps made at different times.
- **A ceiling on brightness.** Every noise voice runs through a lowpass filter. The old set
  reached for a highpass whenever it wanted something to sparkle, which is where the hiss
  came from — the victory and round-title sounds each carried most of a second of it.
- **Stereo.** Voices are placed across the field instead of stacked in the middle, so a
  busy moment reads as several things happening rather than one blob.

Individual sounds that were replaced rather than tuned:

- **The refusal sound** was two square waves at 110 Hz through a lowpass — a buzz. It is
  now two soft knocks.
- **The brass** was a bare sawtooth, which sits bright for the whole note. It is now a
  filtered horn whose brightness opens as the note lands, the way brass actually behaves.
- **The sad trombone** keeps the joke but slides instead of buzzing.
- **The drum roll and brush rolls** are band-limited taps that tighten and grow, rather
  than bursts of hiss.

And three behaviours that were missing:

- **Music gets out of the way.** The pad now ducks under the round title, a guess, the drum
  roll, a correct answer and the victory fanfare, then comes back. Previously they fought
  each other.
- **Rapid clicking no longer stacks.** Each effect has a short gate, so hammering a button
  gives crisp feedback instead of a machine gun.
- **The sounds you hear most often vary.** Clicks, ticks and turn changes rotate through a
  few pitches, so they never settle into an audible loop.

### Sound: now measured, not assumed

`npm run test:audio` renders every effect through the real audio graph — the same voices,
the same room, the same master chain — in an offline audio context, and measures the
result. Whether a sound is *pleasant* still needs ears. But four things it must be are
numbers, and those now run with the rest of the suite:

- nothing clips;
- each effect sits in the loudness band its job implies, measured as the loudest 300 ms
  rather than as peak, because peak says almost nothing about how loud a sound feels;
- the everyday effects stay within 6x of each other, and interface clicks sit below event
  sounds, which sit below the big moments;
- nothing is harsh, measured as the share of energy in the range that stings.

Writing that test immediately found three things wrong with the new set that listening on
one pair of speakers would probably have missed: the hover sound was quiet enough to be
inaudible; the correct-guess sound — one of the biggest moments in the game — was
measurably quieter than the refusal knock; and once it was made louder it became the
harshest sound in the game. All three are fixed.

### Look

The identity is unchanged: paper polaroids, the censor bar, stamps, the dark stage. What
changed is the system underneath and the amount of care in the details.

- **An elevation scale.** Shadows were ad-hoc rgba values scattered through the file. There
  are now four steps, used everywhere, so depth is consistent instead of accidental.
- **Screens arrive in order.** The blocks on a screen rise in sequence rather than all
  appearing at once.
- **The action bar announces itself.** It is the thing that tells you what to do next, and
  when it changed it changed silently. Its contents now animate in.
- **Paper lies crooked.** Cards and polaroids sit at slight angles that straighten when you
  hover them, which is what makes them read as objects on a table rather than as boxes.
- **Buttons feel physical.** A light crosses the face on hover, and the press is crisper.
- **Numbers do not jiggle.** Scores and counters use tabular figures, so a count-up no
  longer shifts the layout on every tick.
- **Contrast.** Muted text and the round chips were the weakest text in the interface;
  both are lifted.
- **Your own row is marked** in the final standings.

### The winner screen

- **A spotlight** snaps on with the winner and then breathes, and the stage now has dark
  corners so the gold reads as a lit centre instead of an even brown haze.
- **The name is polished gold** — a wide gradient that drifts across the letters.
- **A ring of light turns slowly** behind the winners' portraits.
- **The word Champion has flanking rules**, so it reads as a title rather than a stray
  label.
- **The podium blocks have a sheen** and rise with a spring rather than a glide.
- **The confetti is gold** for the victory, so it agrees with the celebration instead of
  competing with it, and the pieces are two shapes rather than identical rectangles.
- **More of the ceremony fits.** On a short window the podium and standings are compacted,
  and scrolling the buttons into view now leaves room at the bottom instead of parking
  them underneath the credits.

Timing is unchanged, so the ceremony still lines up with the sound: the fanfare's chord
lands as the podium blocks start to rise. Skip, ties, reconnects and reduced motion all
behave as before.

### Credits

A small pill in the bottom-left corner: *Discord @brainther · @e47*. It is not clickable,
so it can never swallow a tap, it shrinks on narrow screens, and it is hidden during play
because the action bar owns that corner — so it shows on the menu, the lobby and the
results rather than over the game itself.

### One bug found while doing this

Adding the shared reverb introduced a routing mistake of my own: the music fed the reverb
from before its on/off gain, so switching music off would have left a tail behind. The
music bus now feeds the room from after that gain.


## Takeover pass — 26 November 2026

The previous pass had never been run in a real browser or in Discord. The first job was to
make that possible, then to check what was actually broken rather than assume.

### Verified as already correct

The reported picture and rematch bugs **did not reproduce**. Three consecutive games, with
rematches and with the same file re-uploaded, deal correctly every time:

- every dealt card carries the picture its owner uploaded, checked by reading the pixels
  of the rendered card in a real browser;
- nobody is ever sent the picture of the card they are holding, checked by reading the
  WebSocket traffic, not just the page;
- each round's pictures really are removed from server memory when the round ends,
  checked against the server's own memory.

These are now locked in by tests so they cannot quietly regress.

### Bugs fixed

**1. Every secondary button was floating around the screen.** `ghost` was used as a class
name for two unrelated things: the drifting shapes in the background, and the secondary
button style. Because `.btn` never sets `position`, `height` or `animation`, the background
rule won and applied to the buttons. **How to play, Settings, Pass, Skip turn, Back to
lobby, Cancel guess, Skip** and the zoom dialog's **Close** were all absolutely positioned,
forced to 110×140 px, and animated slowly up the screen on a 26 second loop. The background
shapes are renamed `bg-ghost`.

**2. Those same buttons disappeared completely for players who use reduced motion.** The
reduced-motion rule hides `.ghost`, which was also hitting the buttons. With the operating
system's "reduce motion" setting on, *How to play* and *Settings* were `display: none`.
Fixed by the same rename.

**3. The host could not press "I know it!" on their own turn.** A consequence of (1): the
*Back to lobby* button sat on top of it and swallowed the click. The action bar's sizing is
also corrected so the buttons keep their natural width and the text yields instead, and the
row wraps onto a second line when it has to.

**4. "I know it!" did nothing, with no explanation, when everyone else had dropped out.**
The guess opened and closed in the same instant because there was nobody who could vote.
It now says *"Nobody else is online to judge your guess."*

**5. Anyone logged in could fill the server's memory.** The room id comes from the client,
so inventing a new one each time created unlimited rooms, each able to hold 12 players'
pictures. Rooms are now capped at 200 and the 201st request gets a clear refusal.

**6. A player whose connection died silently could freeze the game.** Nothing detected a
half-open socket, so the turn could sit forever on someone who had actually vanished. The
server now pings every 30 seconds and drops connections that stop answering.

**7. An upload error could appear on the wrong card.** With two uploads in flight the error
was shown on whichever happened to be first. The server now says which card an error
belongs to. An upload for a card that does not exist used to be ignored in silence, leaving
the page waiting for its 8 second timeout; it now gets an answer.

**8. Players gave up on the server while it was still waking up.** The free hosting plan
sleeps when idle and takes up to a minute to come back. The page stopped retrying after
about five seconds and said it could not reach the server. It now keeps trying for about
a minute and explains: *"Waking the game server up… this can take up to a minute."*

**9. A very large picture could crash a phone browser.** The file was read into memory
before anything checked its size. Files over 25 MB are now refused up front.

**10. The music kept playing when the activity was hidden.** It now stops when you switch
away and resumes when you come back.

**11. The winner celebration cut itself short.** The second burst of confetti cancelled the
first mid-air. Bursts now add to each other.

**12. The action bar could sit off-screen on phones.** `100vh` is taller than the visible
area on mobile; `100dvh` is used now, with `100vh` left as a fallback.

**13. The game could not run outside Discord at all.** The page asks for `/.proxy/ws` and
`/.proxy/api/token`, paths that only exist inside Discord's iframe proxy — the server only
answered `/ws` and `/api/...`, so `/.proxy/ws` returned 400. This is why the previous pass
was never tested in a browser. The server now accepts both forms, which changes nothing
inside Discord (the proxy strips the prefix before the request arrives) and makes local
development and automated testing possible.

### Design pass

Every screen was walked through and looked at, at a desktop size and a phone size —
menu, how to play, settings, lobby, uploading, dealing, your turn, someone else's turn,
guessing, voting, round complete, and all three stages of the winner ceremony. There is
now a `npm run screenshots` tool that produces exactly that set, so the next design change
can be checked the same way without going into a voice call.

What changed as a result:

- **The celebration buried the winner on a phone.** Confetti was tuned for a desktop
  window, so the same 300 pieces on a 390px screen covered the champion's name and score
  completely. The amount now scales with the size of the screen.
- **"Play again" was below the fold.** On a short window the winner stage took so much
  room that the podium, the standings and the only button on the screen were all out of
  sight, with nothing to suggest they were there. The celebration is scaled down when the
  window is short, and once the ceremony finishes the buttons are brought into view.
- **The lobby was a very long scroll on a phone.** The three upload cards were each a
  full-width square, so the list of players was pushed far off the top and you could not
  see your own progress. Two cards per row on small screens.
- **Standings rows wrapped differently from each other**, so the rank, the badges, the
  per-round chips and the total landed in a different place on every line. The rank is
  pinned left and the total pinned right now, with only the middle wrapping.

### Added

- **A real test suite, run with `npm test`.** 30 tests against a real server over real
  WebSockets, plus a full game played twice in a real browser with three pages.
- **A way to run the game without Discord**, for development and tests. Enabled only when
  the server is started with `DEV_AUTH=1`, which never happens on Render; without it the
  server refuses these logins, so the feature is inert in production. There is a test that
  proves this.
- **Server logging** of rooms opening and closing, players joining, rejoining and leaving,
  games starting, and each round's pictures being deleted.
- **Pinned dependency versions and a committed lockfile.** `@discord/embedded-app-sdk` was
  `"latest"`, so two deploys could install different code. It is pinned to `2.5.0`.

### Deliberately not changed

- **Gameplay, scoring and round structure** are untouched.
- **`docs/terms.html` and `docs/privacy.html`** are untouched.
- **The visual identity** — polaroids, censor bar, stamps, the dark stage — is kept. The
  design system underneath turned out to be coherent: one spacing scale, one radius scale,
  focus rings, safe-area insets. What made it look unfinished was bug (1), not the
  styling, so the design pass above fixes layout and density rather than restyling.
- **One rule worth a decision from you, left alone.** A guess is judged by a strict
  majority of yes votes. In a three-player game that means one "no" ends the guess
  immediately, while a "yes" needs both other players. The early exit is arithmetically
  correct — once one of two voters says no, a strict majority is impossible — but the
  asymmetry may not be what you want. Changing it is a gameplay decision, so it is left as
  it is.

### Not verified

- **Sound.** All 27 effects are generated in code and the autoplay rules are handled
  correctly, but balance and timing cannot be judged by an automated test. See
  `TEST-REPORT.md`.
- **Discord itself.** The Activity has to be launched in a real voice channel. See the
  manual checklist in `TEST-REPORT.md`.
