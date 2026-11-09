import { expect, test } from "vitest";
import { blinkRest, BLINK_REST_MS } from "./blinkRest";

const clock = () => {
  const waits = new Map<number, { fn: () => void; at: number }>();
  let now = 0;
  let n = 0;
  return {
    wait: (fn: () => void, ms: number) => {
      const id = n++;
      waits.set(id, { fn, at: now + ms });
      return () => void waits.delete(id);
    },
    now: () => now,
    pending: () => waits.size,
    pass(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = [...waits].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at;
        waits.delete(next[0]);
        next[1].fn();
      }
      now = end;
    },
  };
};

test("DT-C231: the cursor holds steady after 5 s with no input and blinks again on the next keystroke", () => {
  const c = clock();
  const set: boolean[] = [];
  const blink = blinkRest((b) => set.push(b), { wait: c.wait, now: c.now });
  blink.want(true);
  expect(set).toEqual([true]);
  c.pass(BLINK_REST_MS - 1);
  expect(set).toEqual([true]);
  c.pass(1);
  expect(set).toEqual([true, false]);
  expect(c.pending()).toBe(0); // nothing keeps ticking while it rests
  blink.poke();
  expect(set).toEqual([true, false, true]);
  c.pass(BLINK_REST_MS);
  expect(set).toEqual([true, false, true, false]);
  expect(BLINK_REST_MS).toBe(5_000);
});

test("typing keeps it blinking, with one timer however fast the keys come", () => {
  const c = clock();
  const set: boolean[] = [];
  const blink = blinkRest((b) => set.push(b), { wait: c.wait, now: c.now });
  blink.want(true);
  for (let i = 0; i < 20; i++) {
    c.pass(1_000);
    blink.poke();
    expect(c.pending()).toBe(1);
  }
  expect(set).toEqual([true]);
  c.pass(BLINK_REST_MS);
  expect(set).toEqual([true, false]);
});

test("a cursor set not to blink never blinks, and re-reading the setting keeps a resting cursor steady", () => {
  const c = clock();
  const set: boolean[] = [];
  const blink = blinkRest((b) => set.push(b), { wait: c.wait, now: c.now });
  blink.want(false);
  blink.poke();
  c.pass(BLINK_REST_MS * 2);
  expect([set, c.pending()]).toEqual([[false], 0]);
  blink.want(true); // the setting turned on
  c.pass(BLINK_REST_MS);
  blink.want(true); // a font change re-reads every option
  expect(set).toEqual([false, true, false, false]);
  blink.poke();
  expect(set[set.length - 1]).toBe(true);
  blink.stop();
  c.pass(BLINK_REST_MS);
  expect(set[set.length - 1]).toBe(true); // stopped: nothing changes after unmount
});
