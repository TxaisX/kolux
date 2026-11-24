// AUD-S2 / S2-F06: live-PROJ-077 reads the composer's setup policy from
// select[aria-label="setup policy"]. No such select, and no such label, is left in src/: the first
// line of run077 reads .value of null and throws, so neither the skip case nor its control runs.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const srcText = (() => {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(fs.readFileSync(p, "utf8"));
    }
  };
  walk(path.join(ROOT, "src"));
  return out.join("\n");
})();

const script = read("scripts/prove/live-PROJ-077.mjs");

describe("audit S2 > live-PROJ-077 setup policy", () => {
  it("[S2-F06] the setup-policy select it reads is rendered by the composer", () => {
    if (script.trimStart().startsWith("// retired:")) return;
    const m = /querySelector\('select\[aria-label="([^"]+)"\]'\)/.exec(script);
    if (!m) return; // rewritten to read the policy some other way
    expect(srcText, `no select labelled "${m[1]}" is rendered`).toContain(`aria-label="${m[1]}"`);
  });
});
