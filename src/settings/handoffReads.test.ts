// Txais (2026-11-21): a context reader that cannot read its store must say so; silence is what made a
// broken reader look like a session that simply had not filled up yet.
import { expect, test } from "vitest";
import { ago, readerLine, readerName } from "./handoffReads";

test("a failed reader says which store it could not read, and it is a problem", () => {
  const failed = readerLine({ agent: "opencode", state: "failed", detail: "no OpenCode database at G:\\x\\opencode.db", tokens: 171_000, ageMs: 5_000 });
  expect(failed).toEqual({ ok: false, text: "no OpenCode database at G:\\x\\opencode.db" });
});

test("a working reader says what it read and when, and a quiet one is not a failure", () => {
  expect(readerLine({ agent: "codex", state: "reading", detail: "", tokens: 171_240, ageMs: 20_000 })).toEqual({ ok: true, text: "Read 171k 20 s ago" });
  expect(readerLine({ agent: "grok", state: "nothing", detail: "", tokens: null, ageMs: 1_000 }).ok).toBe(true);
  expect(readerLine({ agent: "grok", state: "never", detail: "" })).toEqual({ ok: true, text: "Has not run since Kolux started." });
  expect(ago(4_000)).toBe("just now");
  expect(ago(20_000)).toBe("20 s ago");
  expect(ago(600_000)).toBe("10 min ago");
  expect(ago(7_200_000)).toBe("2 h ago");
  expect(ago(null)).toBe("");
});

test("the rows are named the way the agents are", () => {
  expect(readerName("opencode")).toBe("OpenCode");
  expect(readerName("codex")).toBe("Codex");
  expect(readerName("grok")).toBe("Grok");
  expect(readerName("other")).toBe("other");
});
