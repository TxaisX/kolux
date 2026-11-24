// AUD-S1 / S1-F02: scripts/docs/build.mjs stamps every generated twin with the wall-clock date,
// and --check compares the whole file, so every committed twin turns "stale" at midnight even
// though no markdown changed. This builds a page, ages only its footer line, and asks --check
// whether the page is stale.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILDER = path.join(HERE, "docs", "build.mjs");
const build = (...args) =>
  spawnSync(process.execPath, [BUILDER, ...args], { encoding: "utf8", windowsHide: true });

describe("audit S1 · docs builder --check", () => {
  it("[S1-F02] a twin whose markdown did not change is not stale because its date stamp is old", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "krs-docs-"));
    const md = path.join(dir, "page.md");
    fs.writeFileSync(md, "<!-- html -->\n# Page\n\nOne paragraph.\n");
    const built = build(md);
    expect(built.status, built.stderr || built.stdout).toBe(0);

    const html = path.join(dir, "page.html");
    const stamp = fs.readFileSync(html, "utf8");
    const older = stamp.replace(/generated \d{4}-\d{2}-\d{2} by/, "generated 2001-01-01 by");
    expect(older).not.toBe(stamp); // the footer carries the date this file was generated
    fs.writeFileSync(html, older);

    const checked = build("--check", md);
    expect(checked.status, checked.stderr || checked.stdout).toBe(0);
  });
});
