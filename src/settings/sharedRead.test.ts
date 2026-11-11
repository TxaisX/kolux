// PKG-4: reads that overlap share one get_settings; a read after one has settled is a real read again.
import { expect, test } from "vitest";
import { sharedReader } from "./sharedRead";

function stub() {
  const calls: Array<{ ok: (s: Record<string, unknown>) => void; no: (e: unknown) => void }> = [];
  const invoke = (_cmd: string) => new Promise<Record<string, unknown>>((ok, no) => void calls.push({ ok, no }));
  return { calls, invoke };
}

test("callers that ask while a read is in flight share it", async () => {
  const { calls, invoke } = stub();
  const read = sharedReader(invoke);
  const a = read();
  const b = read();
  const c = read();
  expect(calls.length).toBe(1);
  calls[0].ok({ n: 1 });
  expect(await Promise.all([a, b, c])).toEqual([{ n: 1 }, { n: 1 }, { n: 1 }]);
});

test("once a read has settled the next call is a real read (no cache)", async () => {
  const { calls, invoke } = stub();
  const read = sharedReader(invoke);
  const first = read();
  calls[0].ok({ n: 1 });
  await first;
  const second = read(); // e.g. after a save
  expect(calls.length).toBe(2);
  calls[1].ok({ n: 2 });
  expect(await second).toEqual({ n: 2 });
});

test("a failed read fails every sharer, and the next call tries again", async () => {
  const { calls, invoke } = stub();
  const read = sharedReader(invoke);
  const a = read();
  const b = read();
  calls[0].no("unreadable");
  await expect(a).rejects.toBe("unreadable");
  await expect(b).rejects.toBe("unreadable");
  const again = read();
  expect(calls.length).toBe(2);
  calls[1].ok({ n: 3 });
  expect(await again).toEqual({ n: 3 });
});
