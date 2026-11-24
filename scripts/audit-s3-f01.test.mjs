// AUD-S3 / S3-F01: tools/kolux-memory/README.md says "Sources are opened read-only. A missing
// source produces a smaller database, never a crash", and build() itself catches a failure to
// read the sessions store and records it as `sessions_error`. That catch is defeated: after it,
// the same handle is used for the message query, so a store whose schema does not answer both
// queries kills the whole build (and leaves its open .building file behind).
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { build, openDb, status } from "../tools/kolux-memory/lib.mjs";

describe("audit S3 · memory build over a source it cannot read", () => {
  it("[S3-F01] a sessions store with no message table still produces a database", () => {
    const root = mkdtempSync(join(tmpdir(), "audit-s3-f01-"));
    const sessions = join(root, "sessions.db");
    const store = new DatabaseSync(sessions);
    store.exec("create table session_v2(id text, parent_id text, title text, directory text, agent text, model text, time_created integer, time_updated integer, cost real, tokens_input integer, tokens_output integer)");
    store.close();

    const repo = join(root, "repo");
    mkdirSync(join(repo, "spec"), { recursive: true });
    writeFileSync(join(repo, "spec", "01-audit.md"), "### APP-001 · one card\nTier: P0\nAcceptance:\n  - [ ] one\n");

    const db = join(root, "memory.db");
    try {
      const res = build({ sessions, repo, vault: join(root, "vault"), db, github: false, git: false });
      expect(res.counts.sessions).toBe(0);
      expect(res.counts.cards).toBe(1);
      const opened = openDb(db);
      expect(status(opened, db).sessions).toBe(0);
      opened.close();
    } finally {
      // A crashed build leaves its temp database open and locked; the point of this test is that
      // it must not crash, so a failed cleanup must not hide the real assertion.
      try { rmSync(root, { recursive: true, force: true }); } catch { /* open temp file */ }
    }
  });
});
