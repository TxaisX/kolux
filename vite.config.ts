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
  build: {
    // The vendor marks (src/marks/registry.ts) were inlined as data: URIs, 22 kB of text in the first-load script.
    // As files they are read with the first icons drawn; everything else keeps Vite's default rule.
    assetsInlineLimit: (file: string) => (/[\\/]assets[\\/]vendors[\\/]/.test(file) ? false : undefined),
    rolldownOptions: {
      output: {
        // The editor stack was one 900 kB chunk named after whichever small module came first (pictureBytes).
        // Named groups keep CodeMirror, the Markdown editor (Lexical) and the code colouring in files of their
        // own, so what a surface needs is fetched on its own and the build output says which part is big.
        codeSplitting: {
          groups: [
            // Core only: the language packs (lang-*, legacy-modes) are imported one at a time on purpose and must stay out.
            { name: "codemirror", test: /node_modules[\\/](@codemirror[\\/](state|view|language|commands|search|autocomplete|lint|merge|streamparser)|codemirror|@lezer[\\/](common|highlight|lr)|@marijn|style-mod|w3c-keyname|crelt)[\\/]/, priority: 30 },
            { name: "lexical", test: /node_modules[\\/](lexical|@lexical|@preact[\\/]signals-core)[\\/]/, priority: 30 },
            { name: "highlightjs", test: /node_modules[\\/]highlight\.js[\\/]/, priority: 30 },
            { name: "markdown-tools", test: /node_modules[\\/](marked|dompurify)[\\/]/, priority: 30 },
          ],
        },
      },
    },
  },
  test: {
    // LOOP.md section 1: the PC is shared with live agents; never more than two workers.
    maxWorkers: 2,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.mjs"],
  },
}));
