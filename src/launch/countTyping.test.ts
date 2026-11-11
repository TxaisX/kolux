// SESS-013 (sim-b P10): the sessions count box applies what is typed once typing pauses, without leaving the box.
import { expect, test, vi } from "vitest";
import { COUNT_PAUSE_MS, countPlan, pauseThen } from "./seats";

test("typing 1 then 2 applies 12 once, a pause after the last key; leaving the box first applies it only once", () => {
  vi.useFakeTimers();
  try {
    const applied: number[] = [];
    let box = "";
    const typing = pauseThen(COUNT_PAUSE_MS);
    const key = (c: string) => ((box += c), typing.later(() => applied.push(Number(box))));
    key("1");
    vi.advanceTimersByTime(COUNT_PAUSE_MS - 100);
    key("2");
    vi.advanceTimersByTime(COUNT_PAUSE_MS - 1);
    expect(applied).toEqual([]); // still typing: no one-seat moment
    vi.advanceTimersByTime(1);
    expect(applied).toEqual([12]);
    // 12 is above the ask line, so the question shows now, not on blur
    expect(countPlan(12, 1)).toEqual({ n: 12, ask: true });
    key("3");
    typing.cancel(); // the box was left (blur applies at once and drops the pending one)
    vi.advanceTimersByTime(COUNT_PAUSE_MS * 2);
    expect(applied).toEqual([12]);
  } finally {
    vi.useRealTimers();
  }
});
