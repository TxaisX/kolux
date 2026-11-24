// AUD-S3 / S3-F04: the resume brief ends with "## Next", a numbered list of what to do next.
// Its numbers are written by hand: in resumeMarkdown the first item is always "1." and the last
// is "3." whenever one of the two optional items is skipped, so the brief prints 1 then 3.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { build, openDb, resumeMarkdown } from "../tools/kolux-memory/lib.mjs";

describe("audit S3 · the resume brief's next steps", () => {
  it("[S3-F04] the next-steps list has no gap in its numbering", () => {
    const root = mkdtempSync(join(tmpdir(), "audit-s3-f04-"));
    const repo = join(root, "repo");
    mkdirSync(join(repo, "spec"), { recursive: true });
    // One open P0 card and no failing evidence: the brief skips its "start with the failures"
    // item, which is the branch that writes a number out of order.
    writeFileSync(join(repo, "spec", "01-audit.md"), "### APP-001 · one open card\nTier: P0\nAcceptance:\n  - [ ] one\n");
    const db = join(root, "memory.db");
    try {
      build({ sessions: join(root, "none.db"), repo, vault: join(root, "vault"), db, github: false, git: false });
      const opened = openDb(db);
      const md = resumeMarkdown(opened, db);
      opened.close();
      const next = md.slice(md.indexOf("## Next"));
      expect(next).not.toBe("");
      const numbers = [...next.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
      expect(numbers.length).toBeGreaterThan(1);
      expect(numbers).toEqual(numbers.map((_, i) => i + 1));
    } finally {
      try { rmSync(root, { recursive: true, force: true }); } catch { /* open temp file */ }
    }
  });
});
