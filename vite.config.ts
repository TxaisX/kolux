import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

// T-500: the release policy from src-tauri/tauri.conf.json (Tauri applies it when it serves the
// app) sent by the dev server too, with what the dev server itself needs: its inline client
// script and its reload socket. csp.test.ts keeps the two in step. T-590: frame-ancestors 'none' keeps
// any web page from framing Kolux; it only works as a header, which is how both policies are sent.
const DEV_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://github.com https://avatars.githubusercontent.com http://kolux-artifact.localhost kolux-artifact:; media-src http://kolux-artifact.localhost kolux-artifact:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost ws://localhost:1420; frame-src http://kolux-artifact.localhost kolux-artifact:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'";

export default defineConfig(() => ({
  plugins: [react()],
  // Tauri drives the dev server: fixed port, no screen clearing, ignore the Rust tree.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
    headers: { "Content-Security-Policy": DEV_CSP },
  },
  test: {
    // LOOP.md section 1: the PC is shared with live agents; never more than two workers.
    maxWorkers: 2,
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
}));
