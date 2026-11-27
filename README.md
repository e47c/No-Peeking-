# No peeking! (Discord Activity)

A party game for Discord voice calls. Everyone uploads 3 character images, then you guess your own hidden character.

## How it works now
- GitHub keeps your code.
- A host (Render) runs the game 24/7 from your GitHub code. **No tunnel, no `npm install` on your computer.**
- When you change a file on GitHub, the host updates the game by itself (1-3 minutes).

---

## Step 1: Fill in the legal pages
Open `docs/terms.html` and `docs/privacy.html`. Search for the red parts that start with `[YOUR` and replace them:
- `[YOUR NAME OR TEAM NAME]`
- `[YOUR CONTACT EMAIL]` (use an email you check, Discord may contact it)
- `[NAME OF YOUR HOST, e.g. Render]`

## Step 2: Put the code on GitHub
1. Create a **public** repository on github.com (example name: `no-peeking`).
2. Upload everything from this folder (drag the files in, or use GitHub Desktop).
3. **Never upload your Client Secret.** It must only go in the host's settings (Step 4).

## Step 3: Turn on GitHub Pages (for the Terms and Privacy links)
1. In your repo: **Settings -> Pages**.
2. Source: **Deploy from a branch**. Branch: **main**. Folder: **/docs**. Save.
3. After 1-2 minutes your links are:
   - `https://YOUR-USERNAME.github.io/YOUR-REPO/terms.html`
   - `https://YOUR-USERNAME.github.io/YOUR-REPO/privacy.html`

## Step 4: Run the game on Render
1. Go to render.com, sign up, click **New -> Web Service**, and connect your GitHub repo.
   (Or **New -> Blueprint**, which reads `render.yaml` for you.)
2. If asked: Build Command `npm install && npm run build`, Start Command `npm start`.
3. Add **Environment Variables**:
   - `VITE_CLIENT_ID` = your Client ID
   - `CLIENT_SECRET` = your Client Secret
   - `PUBLIC_URL` = your Render link, for example `https://no-peeking.onrender.com` (you see it after creating the service, then add it and redeploy)
4. Wait for "Live". Open `https://YOUR-APP.onrender.com/healthz`. It should say `ok`.

## Step 5: Tell Discord (Developer Portal)
1. **Activities -> URL Mappings**: Prefix `/`, Target `YOUR-APP.onrender.com` (no `https://`).
2. **General Information**: paste your **Terms of Service URL** and **Privacy Policy URL** (from Step 3).
3. Save.

You do this only once. The link never changes.

## Updating the game later
Edit a file on GitHub (pencil icon) -> **Commit changes** -> wait for Render to redeploy.
A redeploy restarts the server, so a game in progress is lost. Update when nobody is playing.

## Optional: run on your own computer
Copy `config.local.example.json` to `config.local.json`, fill it in, then `npm install` and `npm run dev` (and `npm run tunnel`). `config.local.json` is ignored by Git, so it is never uploaded.

---

## Running the game without Discord

Discord only lets the Activity run inside a voice call, which makes it awkward to check
your work. The game can also run in an ordinary browser tab.

```bash
npm install
npm run build
DEV_AUTH=1 VITE_CLIENT_ID=000000000000000000 CLIENT_SECRET=x npm start
```

Then open one tab per player:

- <http://localhost:3001/?np_dev=Ana&np_id=a1&np_room=test>
- <http://localhost:3001/?np_dev=Ben&np_id=b2&np_room=test>
- <http://localhost:3001/?np_dev=Cleo&np_id=c3&np_room=test>

`np_dev` is the player name, `np_id` their id, and `np_room` puts them in the same game.

**`DEV_AUTH=1` turns off the Discord login check.** Never set it on Render. Without it the
server refuses these fake logins, so the `?np_dev=` links do nothing on the live site.

## Tests

```bash
npm test          # everything
npm run test:server   # game rules, over a real server and real WebSockets
npm run test:browser  # a full game in a real browser, three players
npm run test:audio    # every sound effect measured: level, balance, harshness
```

The browser tests need Chromium once: `npx playwright install chromium`.

`test:browser` plays two complete games with three browser pages. It reads the pixels of
every card to prove each one shows the picture its owner uploaded, and it reads the
WebSocket traffic to prove the card you are holding is never sent to your browser at all.

`test:audio` renders each of the 27 effects through the real audio graph in an offline
audio context and measures it. Whether a sound is *pleasant* needs ears, and the checklist
in `TEST-REPORT.md` covers that, but three things it must be are numbers: nothing clips,
the set is balanced so no effect drowns its neighbours, and nothing is harsh. It prints a
table of every effect, so you can also just read it to see what changed.

## Looking at the design without Discord

```bash
npm run build
npm run screenshots
```

Plays a whole game and writes a screenshot of every screen — menu, how-to-play, settings,
lobby, dealing, your turn, someone else's turn, guessing, voting, round complete, and the
three stages of the winner ceremony — at a desktop size and a phone size, into
`screenshots/`. Useful for checking a design change before taking it into a voice call.
