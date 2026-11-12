// Reads your settings. On the host (Render) they come from "Environment Variables".
// On your own computer (optional) they can come from config.local.json (never uploaded to GitHub).
import fs from "fs";

let local = {};
try { local = JSON.parse(fs.readFileSync("config.local.json", "utf8")); } catch {}

export const CLIENT_ID = process.env.VITE_CLIENT_ID || process.env.CLIENT_ID || local.CLIENT_ID || "";
export const CLIENT_SECRET = process.env.CLIENT_SECRET || local.CLIENT_SECRET || "";
