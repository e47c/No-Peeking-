# Changelog

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
  design system underneath turned out to be coherent; what made it look amateur was bug (1),
  not the styling.
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
