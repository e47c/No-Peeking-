# Changelog

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
