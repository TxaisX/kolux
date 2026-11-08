// T-816: every child process a script under scripts/ or tools/ starts asks for no console window
// (`windowsHide: true`), so running a gate, a proof or a release never flashes a black window. A new
// spawn without it fails here. Test files are scanned too: they run under the same gates.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPAWNERS = new Set(["spawnSync", "spawn", "execFileSync", "execFile", "execSync", "exec", "fork"]);

/** The `child_process` calls in `text` (by name, as imported) whose own arguments never say windowsHide. */
export function unhiddenSpawns(text) {
  if (!/child_process/.test(text)) return [];
  // Only the names the file takes from child_process (plain or `cp.`-qualified) are spawns; a
  // regex's `.exec(` or a database's `db.exec(` is not.
  const named = new Set();
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']node:child_process["']|import\s*\{([^}]*)\}\s*from\s*["']child_process["']/g)) {
    for (const part of (m[1] ?? m[2]).split(",")) {
      const [imported, local = imported] = part.trim().split(/\s+as\s+/);
      if (SPAWNERS.has(imported)) named.add(local);
    }
  }
  const ns = [...text.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s*["'](?:node:)?child_process["']/g)].map((m) => m[1]);
  const found = [];
  for (const m of text.matchAll(/\b(\w+)\s*\(/g)) {
    const prefix = text.slice(Math.max(0, m.index - 30), m.index);
    const qualified = /(\w+)\.$/.exec(prefix)?.[1];
    if (qualified ? !(ns.includes(qualified) && SPAWNERS.has(m[1])) : !named.has(m[1])) continue;
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    if (/^\s*(export\s+)?(async\s+)?function\b/.test(text.slice(lineStart, m.index + 1))) continue; // a declaration
    let i = m.index + m[0].length;
    for (let depth = 1; i < text.length && depth; i++) depth += text[i] === "(" ? 1 : text[i] === ")" ? -1 : 0;
    if (!/windowsHide/.test(text.slice(m.index, i))) found.push(text.slice(0, m.index).split("\n").length);
  }
  return found;
}

function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") files(p, out);
    } else if (/\.(mjs|js|cjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("T-816 scripts start no console window", () => {
  it("finds an unhidden spawn and passes a hidden one (the check itself)", () => {
    const head = 'import { spawnSync, spawn as run } from "node:child_process";\n';
    expect(unhiddenSpawns(head + 'spawnSync("git", ["status"]);\n')).toEqual([2]);
    expect(unhiddenSpawns(head + 'run("git", [], {\n  cwd: x,\n});\n')).toEqual([2]);
    expect(unhiddenSpawns(head + 'spawnSync("git", ["status"], { windowsHide: true });\n')).toEqual([]);
    expect(unhiddenSpawns(head + 'run("git", [], {\n  windowsHide: true,\n});\n')).toEqual([]);
    expect(unhiddenSpawns(head + "const m = /x/.exec(s);\n")).toEqual([]);
    expect(unhiddenSpawns('import * as cp from "node:child_process";\ncp.execFileSync("git");\n')).toEqual([2]);
  });

  it("every spawn under scripts/ and tools/ passes windowsHide", () => {
    const bad = [];
    const self = fileURLToPath(import.meta.url);
    for (const f of [...files(path.join(ROOT, "scripts")), ...files(path.join(ROOT, "tools"))].filter((f) => path.resolve(f) !== path.resolve(self))) {
      for (const line of unhiddenSpawns(fs.readFileSync(f, "utf8"))) bad.push(`${path.relative(ROOT, f).replace(/\\/g, "/")}:${line}`);
    }
    expect(bad).toEqual([]);
  });
});
