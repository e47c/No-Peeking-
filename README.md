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
