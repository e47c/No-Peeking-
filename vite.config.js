import { defineConfig } from "vite";
import { CLIENT_ID } from "./config.js";

export default defineConfig(({ command }) => {
  if (command === "build" && !CLIENT_ID) {
    throw new Error("VITE_CLIENT_ID is missing. Add it in your host's Environment Variables.");
  }
  return {
    define: { __CLIENT_ID__: JSON.stringify(CLIENT_ID) },
    server: {
      port: 5173,
      allowedHosts: true,
      hmr: { clientPort: 443 },
      proxy: {
        "/api": { target: "http://localhost:3001", changeOrigin: true },
        "/ws": { target: "ws://localhost:3001", ws: true },
      },
    },
  };
});
