// Keeps docs/guide/feature-map.md honest (Goal 0, item 6): the map must exist, keep the screens it has mapped, and
// every `data-testid="..."` it quotes must still be in src/. A renamed test id makes the map wrong, which is the whole
// failure mode this lane keeps hitting: a document that describes a surface the app no longer has.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { test } = process.env.VITEST ? await import("vitest") : await import("node:test");

const ROOT = fileURLToPath(new URL("../", import.meta.url)).replace(/[\\/]+$/, "");
const MAP = join(ROOT, "docs/guide/feature-map.md");

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(e.name)) out.push(p);
  }
  return out;
};

test("the feature map exists and still covers the three screens it started with", () => {
  const md = readFileSync(MAP, "utf8");
  for (const screen of ["## 1. Sidebar", "## 2. New session chooser", "## 3. Pane header"]) {
    assert.ok(md.includes(screen), `feature-map.md lost its "${screen.slice(3)}" section`);
  }
  // The verdict legend and the counts table are what make the map readable; a rewrite that drops them is a regression.
  for (const part of ["How to read a row", "live-pass", "check-exists", "pending", "## 5. Counts"]) {
    assert.ok(md.includes(part), `feature-map.md lost "${part}"`);
  }
});

test("every data-testid the feature map quotes is still declared in src/", () => {
  const md = readFileSync(MAP, "utf8");
  const quoted = [...new Set([...md.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]))];
  assert.ok(quoted.length >= 5, `feature-map.md quotes only ${quoted.length} test ids; the map should name real hooks`);
  const src = walk(join(ROOT, "src"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  const missing = quoted.filter((id) => !src.includes(`data-testid="${id}"`));
  assert.deepEqual(missing, [], `feature-map.md quotes test ids src/ no longer declares: ${missing.join(", ")}`);
});
