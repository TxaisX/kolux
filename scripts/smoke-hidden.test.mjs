// Every process the smoke scripts start is hidden: no console window may pop up on the user's screen.
// Node spawn/exec/execFile (and Sync variants) carry windowsHide: true; PowerShell is started with -WindowStyle Hidden.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const files = ["scripts/evidence/smoke.mjs", "scripts/evidence/app-launch.mjs", "scripts/evidence/cdp.mjs"];
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

// Each call's text runs from its name to the end of its statement (a ';' at depth 0 of the parentheses).
const calls = (src) => {
  const out = [];
  for (const m of src.matchAll(/(?<![.\w])(spawn|spawnSync|exec|execSync|execFile|execFileSync)\(/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) depth += src[i] === "(" ? 1 : src[i] === ")" ? -1 : 0;
    out.push(src.slice(m.index, i));
  }
  return out;
};

test.each(files)("%s: every spawn/exec call is windowsHide", (f) => {
  for (const c of calls(read(f))) expect(c, c.slice(0, 80)).toMatch(/windowsHide:\s*true/);
});

test.each(files)("%s: every PowerShell start is -WindowStyle Hidden", (f) => {
  const src = read(f);
  for (const m of src.matchAll(/["']powershell(?:\.exe)?["']\s*,\s*\[([^\]]*)\]/g)) expect(m[1], m[0].slice(0, 80)).toContain('"-WindowStyle", "Hidden"');
  expect(src).not.toMatch(/Start-Process|cmd(\.exe)?["']?,\s*\[\s*["']\/c["']\s*,\s*["']start/);
});

test("the checks see the calls (the scan is not empty)", () => {
  expect(calls(read("scripts/evidence/app-launch.mjs")).length).toBeGreaterThanOrEqual(4);
});
