// AUD-S3 / S3-F05: tools/kolux-memory/README.md says credential-shaped strings in stored text are
// replaced with `[redacted]`, including `key=value` secrets, and that recorded items are replayed on
// every build. recordItem() writes title, detail and evidence as given: the ledger line, the row and
// the search body all keep `password=...` in plain text, and every rebuild copies it back.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { build, openDb, recordItem } from "../tools/kolux-memory/lib.mjs";

const PASSWORD = "hunter2hunter2hunter2";
const API_KEY = "abcdefghijklmnopqrstuvwx";

describe("audit S3 · the work-item ledger", () => {
  it("[S3-F05] a recorded item is redacted in the ledger and in the database", () => {
    const root = mkdtempSync(join(tmpdir(), "audit-s3-f05-"));
    const db = join(root, "memory.db");
    const repo = join(root, "repo");
    mkdirSync(join(repo, "spec"), { recursive: true });
    writeFileSync(join(repo, "spec", "01-audit.md"), "### APP-001 · one card\nTier: P0\nAcceptance:\n  - [ ] one\n");

    try {
      build({ sessions: join(root, "none.db"), repo, vault: join(root, "vault"), db, github: false, git: false });
      const recorded = recordItem({
        db,
        title: "Connect the client",
        detail: `sent the request with password=${PASSWORD}`,
        evidence: `api_key=${API_KEY}`,
      });

      const ledger = readFileSync(recorded.ledger, "utf8");
      expect(ledger).not.toContain(PASSWORD);
      expect(ledger).not.toContain(API_KEY);
      expect(ledger).toContain("[redacted]");

      const opened = openDb(db);
      const row = opened.prepare("select detail, evidence from work_items").get();
      const body = opened.prepare("select body from search where kind='work'").get();
      opened.close();
      expect(row.detail).not.toContain(PASSWORD);
      expect(row.evidence).not.toContain(API_KEY);
      expect(body.body).not.toContain(PASSWORD);
      expect(body.body).toContain("[redacted]");
    } finally {
      try { rmSync(root, { recursive: true, force: true }); } catch { /* open temp file */ }
    }
  });
});
