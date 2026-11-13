// T-783: THIRD-PARTY-NOTICES.txt is bundled, and what builds it groups equal licence texts and keeps each package's copyright line.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HEADER, NOTICES, groupJs, licenceText, renderJs } from "./notices.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = (dir, files) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "krs-notices-"));
  for (const [n, t] of Object.entries(files)) fs.writeFileSync(path.join(d, n), t);
  return d;
};

describe("third-party notices", () => {
  it("the bundle config stages the committed file under its own name, and the file is the real thing", () => {
    const conf = JSON.parse(fs.readFileSync(path.join(ROOT, "src-tauri", "tauri.conf.json"), "utf8"));
    expect(conf.bundle.resources).toMatchObject({ "resources/THIRD-PARTY-NOTICES.txt": "THIRD-PARTY-NOTICES.txt" });
    expect(path.resolve(ROOT, "src-tauri", "resources", "THIRD-PARTY-NOTICES.txt")).toBe(NOTICES);
    const text = fs.readFileSync(NOTICES, "utf8");
    expect(text.startsWith(HEADER.slice(0, 40))).toBe(true);
    expect(text).toContain("PART 1: Rust packages");
    expect(text).toContain("PART 2: JavaScript packages");
    for (const name of ["tauri", "serde", "tokio", "react", "@xterm/xterm"]) expect(text, name).toContain(`\n  ${name} `);
  });

  it("the release overlay adds the CLI to the notices, it does not replace them (objects merge)", () => {
    const rel = fs.readFileSync(path.join(ROOT, "scripts", "release.mjs"), "utf8");
    expect(rel).toMatch(/bundle: \{ resources \}/);
    expect(rel).toMatch(/const resources = \{ \[/); // an object map, so the merge patch keeps the base entry
  });

  it("reads a package's LICENSE file (any case, CRLF) and says nothing for a package without one", () => {
    expect(licenceText(pkg("a", { LICENSE: "MIT\r\nCopyright (c) A\r\n", "README.md": "x" }))).toBe("MIT\nCopyright (c) A");
    expect(licenceText(pkg("b", { "license.md": "Apache\n" }))).toBe("Apache");
    expect(licenceText(pkg("c", { "README.md": "x" }))).toBeNull();
    expect(licenceText(undefined)).toBeNull();
  });

  it("groups packages with the same licence text once, keeps different copyright lines apart, and names the licence of one with no file", () => {
    const text = { "/a": "MIT\nCopyright (c) A", "/b": "MIT\nCopyright (c) A", "/c": "MIT\nCopyright (c) C", "/d": null };
    const groups = groupJs(
      { MIT: [{ name: "a", versions: ["1.0.0"], paths: ["/a"] }, { name: "b", versions: ["2.0.0", "2.1.0"], paths: ["/b"], homepage: "https://b.example" }, { name: "c", versions: ["3.0.0"], paths: ["/c"] }], ISC: [{ name: "d", versions: ["4.0.0"], paths: ["/d"], author: "D. Person" }] },
      (p) => text[p],
    );
    expect(groups.map((g) => g.users)).toEqual([["d 4.0.0"], ["a 1.0.0", "b 2.0.0 - https://b.example", "b 2.1.0 - https://b.example"], ["c 3.0.0"]]);
    expect(groups[0].text).toContain("by D. Person");
    const out = renderJs(groups);
    expect(out).toContain("Used by:\n  a 1.0.0");
    expect(out.match(/Copyright \(c\) A/g)).toHaveLength(1);
  });
});
