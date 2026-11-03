// T-591 (brief Phase 1): the JavaScript the main window loads at start may not grow past a recorded
// ceiling. It is the entry script dist/index.html names, the chunks it preloads, and App, which
// main.tsx starts loading at once (FIX-4), each with every chunk it imports statically; chunks loaded
// on demand (the editor and its CodeMirror, Lexical and highlight.js, the pages and settings, the
// browser and PDF panes, diagrams) and the CSS do not count.
// Run after `vite build`:   node scripts/bundle-budget.mjs        exit 0 = within, 1 = over or no build
// ponytail: the ceiling is today's first load (1,471,768 bytes on 2026-10-31, down from 3,182,193 at
// d8f805a6 once the editor, the pages and the browser pane moved behind import(), and from 1,862,966
// when editor/buffers.ts stopped carrying CodeMirror and the help menu's sheet moved behind import())
// plus about 1% for small fixes. It now sits under the 1.5 MB bar the last two cycles were aiming at,
// so the bar itself is what the ceiling holds. What sets the floor: xterm, which the first frame's
// terminal needs; the two sidebars, which are drawn with the first frame; and App's own shell.
// Raised to 1,490,000 on 2026-11-03 for merge train 1 (17 UX PRs, 561 bytes over).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CEILING = 1_490_000;
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");

/** The first-load chunks of a built `dist` folder, their total size in bytes, and whether it is within `ceiling`. */
export function budget(dist = DIST, ceiling = CEILING) {
  const assets = path.join(dist, "assets");
  if (!fs.existsSync(path.join(dist, "index.html"))) throw new Error(`no build at ${dist}: run vite build first`);
  const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  const roots = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="\/assets\/([^"]+\.js)"/g)].map((m) => m[1]);
  const app = fs.readdirSync(assets).filter((f) => /^App-[\w-]+\.js$/.test(f));
  if (app.length !== 1) throw new Error(`expected one App chunk in ${assets}, found ${app.length}: main.tsx's import of App changed, so update this check`);
  const seen = new Set();
  const walk = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    for (const m of fs.readFileSync(path.join(assets, f), "utf8").matchAll(/\b(?:from|import)\s*["']\.\/([^"']+\.js)["']/g)) walk(m[1]);
  };
  [...roots, ...app].forEach(walk);
  const bytes = [...seen].reduce((n, f) => n + fs.statSync(path.join(assets, f)).size, 0);
  return { files: [...seen], bytes, ceiling, ok: bytes <= ceiling };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const r = budget();
  console.log(`bundle-budget: first load ${r.bytes} bytes in ${r.files.length} chunks (ceiling ${r.ceiling})`);
  if (!r.ok) console.error(`bundle-budget: ${r.bytes - r.ceiling} bytes over. Load the new code on demand with import(), or raise CEILING in scripts/bundle-budget.mjs and say why.`);
  console.log(r.ok ? "bundle-budget: OK" : "bundle-budget: FAILED");
  process.exit(r.ok ? 0 : 1);
}
