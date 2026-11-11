import { expect, test } from "vitest";
import { readForOpen } from "./openText";

const later = <T,>() => {
  let ok!: (v: T) => void;
  const p = new Promise<T>((r) => (ok = r));
  return { p, ok };
};

test("opening a file sends the stamp, the read and the draft lookup at once, the stamp first, and waits for one round trip", async () => {
  const sent: string[] = [];
  const stamp = later<{ mtime: number; size: number } | null>();
  const text = later<string>();
  const io = {
    stamp: () => (sent.push("stamp"), stamp.p),
    read: () => (sent.push("read"), text.p),
    draft: () => (sent.push("draft"), Promise.reject(new Error("no store"))),
  };
  const got = readForOpen(io);
  expect(sent).toEqual(["stamp", "read", "draft"]); // nothing waited on an earlier answer
  text.ok("hello\n");
  stamp.ok({ mtime: 5, size: 6 });
  expect(await got.read).toEqual({ stamp: { mtime: 5, size: 6 }, text: "hello\n" });
  expect(await got.draft).toBeNull(); // a failed lookup reads as no draft
});

test("a read-only tab asks for no draft", async () => {
  const sent: string[] = [];
  const got = readForOpen({ stamp: async () => (sent.push("stamp"), null), read: async () => (sent.push("read"), "x"), draft: null });
  expect(await got.draft).toBeNull();
  expect((await got.read).stamp).toBeNull();
  expect(sent).toEqual(["stamp", "read"]);
});
