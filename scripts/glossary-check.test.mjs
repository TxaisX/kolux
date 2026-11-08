import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LABELS, check, entries } from "./glossary-check.mjs";

describe("glossary-check", () => {
  it("passes on the real glossary", () => {
    expect(check()).toEqual([]);
  });

  it("reads bold terms, joins singular and plural, and splits 'A and B'", () => {
    const have = entries("**Automation**\nx\n**Yolo and Manual**\n");
    expect(have.has("automation")).toBe(true);
    expect(have.has("yolo")).toBe(true);
    expect(have.has("manual")).toBe(true);
  });

  it("reports a missing entry and a dropped term that came back", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gloss-"));
    fs.mkdirSync(path.join(dir, "docs"));
    fs.writeFileSync(path.join(dir, "docs", "GLOSSARY.md"), "**Fence**\nold\n");
    const problems = check(dir).join("\n");
    expect(problems).toContain(`no glossary entry for the UI label "${LABELS[0][0]}"`);
    expect(problems).toContain('still defines "Fence"');
  });
});
