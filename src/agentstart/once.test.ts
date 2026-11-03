// 49-ux2: a second click while an agent is still starting must not start a second session.
import { describe, expect, it } from "vitest";
import { ALREADY, once } from "./host";

const done = async () => ({ ok: true as const, dir: "d", agent: "a" });

describe("host once()", () => {
  it("runs the first call, answers a second with the same key at once, and frees the key when the first settles", async () => {
    let release!: () => void;
    let runs = 0;
    const slow = () =>
      new Promise<{ ok: true; dir: string; agent: string }>((r) => {
        runs += 1;
        release = () => r({ ok: true, dir: "d", agent: "a" });
      });
    const first = once("k", slow);
    const second = await once("k", slow);
    expect(second).toEqual({ ok: false, stage: "launch", message: ALREADY });
    expect(runs).toBe(1);
    expect((await once("other", done)).ok).toBe(true); // another key is free
    release();
    expect((await first).ok).toBe(true);
    expect((await once("k", done)).ok).toBe(true);
  });
  it("frees the key when the run throws", async () => {
    await expect(once("t", () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect((await once("t", done)).ok).toBe(true);
  });
});
