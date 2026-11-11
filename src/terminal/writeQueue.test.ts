// PKG-3: the pane's writes to its program, driven by hand: each `terminal_write` answers only when the
// test says so, as a busy backend would.
import { expect, test } from "vitest";
import { JOIN_MAX, writeQueue, type QueuedWrite } from "./writeQueue";

function backend() {
  const sent: QueuedWrite[] = [];
  const answers: { ok: () => void; fail: (e: unknown) => void }[] = [];
  const failures: string[] = [];
  const q = writeQueue(
    (w) => {
      sent.push({ ...w });
      return new Promise((ok, fail) => answers.push({ ok: () => ok(undefined), fail }));
    },
    (e) => failures.push(String(e)),
  );
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return {
    q,
    sent,
    failures,
    data: () => sent.map((w) => w.data),
    inFlight: () => answers.length,
    async answer() {
      answers.shift()!.ok();
      await tick();
    },
    async refuse(e: string) {
      answers.shift()!.fail(e);
      await tick();
    },
  };
}

test("PKG-3: keys typed while a write is out go as one write when it answers, in order", async () => {
  const b = backend();
  void b.q.write(1, "e");
  expect(b.data()).toEqual(["e"]); // nothing out: it goes at once
  for (const k of "cho hi") void b.q.write(1, k);
  expect(b.data()).toEqual(["e"]); // one write in flight
  expect(b.inFlight()).toBe(1);
  await b.answer();
  expect(b.data()).toEqual(["e", "cho hi"]); // the six keys, one round trip
  void b.q.write(1, "\r");
  await b.answer();
  await b.answer();
  expect(b.data()).toEqual(["e", "cho hi", "\r"]);
  expect(b.inFlight()).toBe(0);
});

test("PKG-3: a typed key and the terminal's own reply are never one write; Ctrl+C, Esc and colour replies go alone", async () => {
  const b = backend();
  void b.q.write(1, "a");
  void b.q.write(1, "b");
  void b.q.write(1, "\x1b[I", true); // a focus report: auto
  void b.q.write(1, "c");
  void b.q.write(1, "\x03");
  void b.q.write(1, "d");
  void b.q.write(1, "\x1b");
  void b.q.write(1, "\x1b]11;rgb:0000/0000/0000\x1b\\"); // a colour answer: Windows rewrites it as a whole
  void b.q.write(1, "\x1b[?997;1n");
  void b.q.write(1, "e");
  void b.q.write(1, "f");
  while (b.inFlight()) await b.answer();
  expect(b.sent.map((w) => [w.data, w.auto])).toEqual([
    ["a", false],
    ["b", false],
    ["\x1b[I", true],
    ["c", false],
    ["\x03", false],
    ["d", false],
    ["\x1b", false],
    ["\x1b]11;rgb:0000/0000/0000\x1b\\", false],
    ["\x1b[?997;1n", false],
    ["ef", false],
  ]);
});

test("PKG-3: writes for another terminal or a drop meant for one terminal are never joined across", async () => {
  const b = backend();
  void b.q.write(1, "x");
  void b.q.write(1, "a");
  void b.q.write(1, "b", false, 1); // a drop meant for terminal 1
  void b.q.write(1, "c", false, 1);
  void b.q.write(2, "d"); // the pane restarted: a new terminal
  void b.q.write(2, "e");
  while (b.inFlight()) await b.answer();
  expect(b.sent.map((w) => [w.id, w.data, w.only])).toEqual([
    [1, "x", undefined],
    [1, "a", undefined],
    [1, "bc", 1],
    [2, "de", undefined],
  ]);
});

test("PKG-3: a refused write is said once and the writes after it still go; every promise settles", async () => {
  const b = backend();
  const first = b.q.write(1, "a");
  const joined = [b.q.write(1, "b"), b.q.write(1, "c")];
  const after = b.q.write(1, "\x03");
  await b.answer();
  expect(b.data()).toEqual(["a", "bc"]);
  await b.refuse("terminal 1 is not running");
  expect(b.failures).toEqual(["terminal 1 is not running"]); // once, for the write that failed
  expect(b.data()).toEqual(["a", "bc", "\x03"]); // not dropped, not sent twice
  await b.answer();
  await expect(Promise.all([first, ...joined, after])).resolves.toBeDefined();
  expect(b.sent).toHaveLength(3);
});

test("PKG-3: a large paste arrives whole and in order, a chunk at a time, and keys typed during it keep their place", async () => {
  const b = backend();
  const chunks = Array.from({ length: 5 }, (_, i) => String.fromCharCode(65 + i).repeat(JOIN_MAX));
  let next = 0;
  const pump = () => {
    if (next < chunks.length) void b.q.write(1, chunks[next++]).then(pump);
  };
  pump();
  void b.q.write(1, "k"); // typed while the first chunk is out
  while (b.inFlight()) await b.answer();
  const all = b.data().join("");
  expect(all).toBe(chunks[0] + "k" + chunks.slice(1).join(""));
  expect(b.data().map((d) => d.length)).toEqual([JOIN_MAX, 1, JOIN_MAX, JOIN_MAX, JOIN_MAX, JOIN_MAX]);
  // A joined write never carries more than one paste chunk: text past the cap starts the next write.
  void b.q.write(1, "x");
  void b.q.write(1, "k");
  void b.q.write(1, chunks[0]);
  while (b.inFlight()) await b.answer();
  expect(b.data().slice(6)).toEqual(["x", "k", chunks[0]]);
});

test("PKG-3: a send that throws is reported like a refusal and the queue goes on", async () => {
  const failures: string[] = [];
  const sent: string[] = [];
  let calls = 0;
  const q = writeQueue(
    (w) => {
      calls++;
      if (calls === 1) throw new Error("ipc gone");
      sent.push(w.data);
      return Promise.resolve();
    },
    (e) => failures.push(String(e)),
  );
  await q.write(1, "a");
  await q.write(1, "b");
  expect(failures).toEqual(["Error: ipc gone"]);
  expect(sent).toEqual(["b"]);
});
