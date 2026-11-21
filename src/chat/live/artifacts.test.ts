// T-965: the pure half of the artifacts strip. Rust owns the safety rules (path, link, share, caps);
// these tests pin the rules this side adds: which four files show, what counts as a changed file, how a
// file is drawn, and where the strip sits in the conversation.
import { expect, test } from "vitest";
import { ago, changed, mimeOf, newest, sizeLabel, stampOf, stripIndex, type ArtifactRow } from "./artifacts";

const row = (over: Partial<ArtifactRow> = {}): ArtifactRow => ({ path: "C:/work/demo/artifacts/a.png", name: "a.png", kind: "image", size: 1_000, mtime: 1_000, ...over });

test("the strip keeps four, newest first, and a tie in time stays in name order", () => {
  const rows = [
    row({ path: "p1", name: "one.png", mtime: 5 }),
    row({ path: "p2", name: "b.png", mtime: 9 }),
    row({ path: "p3", name: "a.png", mtime: 9 }),
    row({ path: "p4", name: "old.png", mtime: 1 }),
    row({ path: "p5", name: "mid.png", mtime: 7 }),
  ];
  expect(newest(rows).map((r) => r.name)).toEqual(["a.png", "b.png", "mid.png", "one.png"]);
  expect(newest(rows, 2).map((r) => r.name)).toEqual(["a.png", "b.png"]);
  // The caller's list is not reordered under it.
  expect(rows[0].name).toBe("one.png");
});

test("a stamp moves only when the file's time or size does", () => {
  expect(stampOf(row({ mtime: 10, size: 5 }))).toBe(stampOf(row({ mtime: 10, size: 5 })));
  expect(stampOf(row({ mtime: 10, size: 5 }))).not.toBe(stampOf(row({ mtime: 11, size: 5 })));
  expect(stampOf(row({ mtime: 10, size: 5 }))).not.toBe(stampOf(row({ mtime: 10, size: 6 })));
});

test("only files whose stamp moved are read again", () => {
  const seen = new Map([
    ["same", stampOf(row({ path: "same" }))],
    ["gone", stampOf(row({ path: "gone" }))],
  ]);
  const rows = [row({ path: "same" }), row({ path: "new", size: 2_000 }), row({ path: "same", mtime: 5_000 })];
  // The last one is the same path with a new time, so it is the one that is read.
  expect(changed(seen, rows).map((r) => `${r.path}:${stampOf(r)}`)).toEqual(["new:1000:2000", "same:5000:1000"]);
});

test("a file's MIME comes from its name, and an unknown name falls back to its kind", () => {
  expect(mimeOf(row({ name: "shot.PNG" }))).toBe("image/png");
  expect(mimeOf(row({ name: "page.html", kind: "page" }))).toBe("text/html");
  expect(mimeOf(row({ name: "weird.thing", kind: "image" }))).toBe("application/octet-stream");
  expect(mimeOf(row({ name: "clip.unknown", kind: "video" }))).toBe("video/mp4");
});

test("how long ago, in words a person reads", () => {
  const now = 1_000_000_000;
  expect(ago(now - 5_000, now)).toBe("just now");
  expect(ago(now - 3 * 60_000, now)).toBe("3 min ago");
  expect(ago(now - 5 * 3600_000, now)).toBe("5 h ago");
  expect(ago(now - 3 * 24 * 3600_000, now)).toBe("3 d ago");
});

test("a size reads as bytes, kilobytes or megabytes", () => {
  expect(sizeLabel(812)).toBe("812 B");
  expect(sizeLabel(44 * 1024)).toBe("44 KB");
  expect(sizeLabel(2.3 * 1024 * 1024)).toBe("2.3 MB");
});

test("the strip sits under the last finished turn, above one still running", () => {
  expect(stripIndex([{ row: "message" }, { row: "steps" }, { row: "worked" }, { row: "working" }])).toBe(3);
  expect(stripIndex([{ row: "message" }, { row: "files" }])).toBe(2);
  // No finished-turn marker yet, but a turn is running: above the working line.
  expect(stripIndex([{ row: "message" }, { row: "responding" }])).toBe(1);
  // Nothing to place it against: the end of the list.
  expect(stripIndex([])).toBe(0);
  expect(stripIndex([{ row: "message" }])).toBe(1);
});
