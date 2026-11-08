import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { check, gitIn, readMarker, stripMarker } from "./guide-check.mjs";

const run = (dir, ...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

/** A throwaway repository with one guide page, committed, and its marker pointing at that commit. */
function repo(body = "# Page\n\nText.\n") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guide-"));
  fs.mkdirSync(path.join(dir, "docs", "guide"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "a.ts"), "x");
  const page = path.join(dir, "docs", "guide", "p.md");
  fs.writeFileSync(page, body);
  run(dir, "init", "-q");
  run(dir, "config", "user.email", "t@example.com");
  run(dir, "config", "user.name", "t");
  run(dir, "config", "commit.gpgsign", "false");
  run(dir, "add", "-A");
  run(dir, "commit", "-q", "-m", "content");
  const sha = run(dir, "rev-parse", "--short", "HEAD");
  const mark = (sha) => fs.writeFileSync(page, `${body}\n<!-- verified against: src/a.ts at ${sha} -->\n`);
  mark(sha);
  run(dir, "add", "-A");
  run(dir, "commit", "-q", "-m", "marker");
  return { dir, page, sha, mark };
}

describe("guide-check", () => {
  it("reads a marker and ignores it when comparing", () => {
    expect(readMarker("a\n<!-- verified against: src/a.ts, src-tauri/src/b.rs at 1a2b3c4 -->\n")).toEqual({ files: ["src/a.ts", "src-tauri/src/b.rs"], sha: "1a2b3c4" });
    expect(readMarker("no marker")).toBeNull();
    expect(stripMarker("a\r\n<!-- verified against: x at 1a2b3c4 -->\r\n")).toBe("a");
  });

  it("passes when the page matches its marker commit", () => {
    const { dir } = repo();
    expect(check(dir, gitIn(dir))).toEqual([]);
  });

  it("fails when the page changed after its marker", () => {
    const { dir, page } = repo();
    fs.appendFileSync(page, "\nA new claim.\n");
    expect(check(dir, gitIn(dir)).join("\n")).toContain("changed after its marker commit");
  });

  it("fails on a missing marker, an unknown commit and a listed file that is gone", () => {
    const { dir, page, sha } = repo();
    fs.writeFileSync(page, "# Page\n\nText.\n");
    expect(check(dir, gitIn(dir)).join("\n")).toContain("has no");
    fs.writeFileSync(page, "# Page\n\nText.\n\n<!-- verified against: src/a.ts at deadbeef -->\n");
    expect(check(dir, gitIn(dir)).join("\n")).toContain("is not in this repository's history");
    fs.writeFileSync(page, `# Page\n\nText.\n\n<!-- verified against: src/gone.ts at ${sha} -->\n`);
    expect(check(dir, gitIn(dir)).join("\n")).toContain("src/gone.ts, which no longer exists");
  });
});
