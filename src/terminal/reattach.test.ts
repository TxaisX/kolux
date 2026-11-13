// APP-052 (T-075): a pane takes its terminal back from the run of the service that owns it, over a fake service.
import { describe, expect, it } from "vitest";
import { type Attach, fromThisService, LIMIT_MS, needsSize, orphanOf, reattach, type ServiceInfo, warmAskOf } from "./reattach";

/** A fake terminal service: `down` failed answers before it comes up, then `info`; attach answers from `answers`. */
function fake(info: ServiceInfo, answer: Partial<Attach> = {}, down = 0) {
  const calls = { info: 0, attach: [] as [number, number][] };
  const service = {
    info: async () => {
      calls.info++;
      if (calls.info <= down) throw new Error("not up yet");
      return info;
    },
    attach: async (paneKey: number, generation: number) => {
      calls.attach.push([paneKey, generation]);
      return { state: "fresh", id: null, generation: info.generation, protocol: info.protocol, ...answer } as Attach;
    },
  };
  return { service, calls };
}

/** A clock that advances only by sleeping, so the hard limit is reached without waiting. */
function clock() {
  let t = 0;
  const slept: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
    slept,
  };
}

const run = { generation: 1_700_000_000_000_042, protocol: 1 };

describe("reattach", () => {
  it("takes a terminal back when this run of the service still runs it (webview reload)", async () => {
    const { service, calls } = fake(run, { state: "attached", id: 7 });
    expect(await reattach(service, 3, null, LIMIT_MS, clock())).toEqual({ kind: "attached", id: 7, service: run });
    expect(calls.attach).toEqual([[3, run.generation]]);
  });

  it("starts fresh when the service runs nothing for the pane", async () => {
    const { service } = fake(run);
    expect(await reattach(service, 3, run, LIMIT_MS, clock())).toEqual({ kind: "fresh", service: run });
  });

  it("says replaced when the pane's terminal belonged to another run, asking with the run it knew", async () => {
    const newer = { generation: run.generation + 1000, protocol: 1 };
    const { service, calls } = fake(newer, { state: "replaced" });
    expect(await reattach(service, 3, run, LIMIT_MS, clock())).toEqual({ kind: "replaced", service: newer });
    expect(calls.attach).toEqual([[3, run.generation]]);
  });

  it("waits for a service still coming up, then attaches", async () => {
    const { service, calls } = fake(run, { state: "attached", id: 9 }, 2);
    const c = clock();
    expect(await reattach(service, 3, null, LIMIT_MS, c)).toEqual({ kind: "attached", id: 9, service: run });
    expect(calls.info).toBe(3);
    expect(c.slept).toEqual([100, 100]);
  });

  it("gives up at the hard limit instead of hanging when the service never answers", async () => {
    const { service, calls } = fake(run, {}, Number.POSITIVE_INFINITY);
    const c = clock();
    const back = await reattach(service, 3, null, LIMIT_MS, c);
    expect(back).toEqual({ kind: "timeout", waited: LIMIT_MS, reason: "the terminal service did not answer within 3 s" });
    expect(c.now()).toBe(LIMIT_MS);
    expect(calls.info).toBe(LIMIT_MS / 100 + 1);
    expect(calls.attach).toEqual([]);
  });

  it("refuses a service older than the oldest protocol this window speaks", async () => {
    const { service, calls } = fake({ generation: 5, protocol: 0 });
    expect(await reattach(service, 3, null, LIMIT_MS, clock())).toEqual({ kind: "refused", reason: "the terminal service speaks protocol 0; this window needs 1 or newer" });
    expect(calls.attach).toEqual([]);
  });

  it("works with a newer service (additions only)", async () => {
    const newer = { generation: 5, protocol: 7 };
    const { service } = fake(newer);
    expect(await reattach(service, 3, null, LIMIT_MS, clock())).toEqual({ kind: "fresh", service: newer });
  });
});

describe("fromThisService", () => {
  it("drops output from a replaced run and keeps everything else", () => {
    expect(fromThisService(run.generation, run)).toBe(true);
    expect(fromThisService(run.generation + 1, run)).toBe(false);
    expect(fromThisService(undefined, run)).toBe(true);
    expect(fromThisService(run.generation + 1, null)).toBe(true);
  });
});

describe("after-list #378 (ACCT-063): a pane closed while its reattach waited", () => {
  const info: ServiceInfo = { protocol: 1, generation: 4 } as ServiceInfo;
  it("kills the terminal the service handed back, and only that case", () => {
    expect(orphanOf({ kind: "attached", id: 9, service: info }, false)).toBe(9);
    expect(orphanOf({ kind: "attached", id: 9, service: info }, true)).toBeNull();
    expect(orphanOf({ kind: "fresh", service: info }, false)).toBeNull();
    expect(orphanOf(null, false)).toBeNull();
  });
});

describe("after-list #378 (ACCT-063): the local terminal a reattach hands back is ended exactly once, whichever order the close comes in", () => {
  // The pane's two exits, as TerminalPane does them: the answer path ends an orphan, the unmount ends what the pane holds.
  async function pane(closeWhen: "before-answer" | "after-answer", answer: Partial<Attach>) {
    const kills: number[] = [];
    let alive = true;
    let held: number | null = null;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { service } = fake(run, answer);
    const slow = { ...service, attach: async (k: number, g: number) => (await gate, service.attach(k, g)) };
    const unmount = () => {
      alive = false;
      if (held !== null) kills.push(held);
    };
    const started = (async () => {
      const back = await reattach(slow, 1, null);
      const orphan = orphanOf(back, alive);
      if (orphan !== null) kills.push(orphan);
      if (alive && back.kind === "attached") held = back.id;
    })();
    if (closeWhen === "before-answer") unmount();
    release();
    await started;
    if (closeWhen === "after-answer") unmount();
    return kills;
  }

  it("a tab closed before the answer: the answer path ends the terminal", async () => {
    expect(await pane("before-answer", { state: "attached", id: 7 })).toEqual([7]);
  });
  it("a tab closed after the answer: the unmount ends the terminal it holds", async () => {
    expect(await pane("after-answer", { state: "attached", id: 7 })).toEqual([7]);
  });
  it("nothing is ended when no terminal was handed back", async () => {
    expect(await pane("before-answer", { state: "fresh" })).toEqual([]);
    expect(await pane("after-answer", { state: "fresh" })).toEqual([]);
  });
  it("DT-C248: a pane unmounted on its way to another cell leaves the terminal its late answer brings to the next mount", () => {
    const back = { kind: "attached", id: 7, service: run } as const;
    expect(orphanOf(back, false, true)).toBeNull();
    expect(orphanOf(back, false, false)).toBe(7);
    expect(orphanOf(back, true, true)).toBeNull();
  });
});

describe("DT-C248 review: the size goes to a terminal taken back", () => {
  it("an attached terminal is sized once the id is bound; a started one was spawned at the view's size", () => {
    expect(needsSize({ kind: "attached", id: 7, service: run })).toBe(true);
    expect(needsSize({ kind: "fresh", service: run })).toBe(false);
    expect(needsSize({ kind: "replaced", service: run })).toBe(false);
    expect(needsSize(null)).toBe(false);
  });
});

describe("kept-warm shell", () => {
  const base = { on: true, key: 4, restored: false, moved: false, program: null, args: [], env: undefined, typed: undefined, agent: "shell", account: undefined, cwd: "C:/work/a" };
  it("a new plain shell in a folder asks for the folder's warm shell at its size", () => {
    expect(warmAskOf(base, 120, 30)).toEqual({ cwd: "C:/work/a", cols: 120, rows: 30 });
  });
  it("never with the setting off, and never for anything a warm shell is not", () => {
    expect(warmAskOf({ ...base, on: false }, 80, 24)).toBeNull();
    expect(warmAskOf({ ...base, key: undefined }, 80, 24)).toBeNull();
    expect(warmAskOf({ ...base, restored: true }, 80, 24)).toBeNull();
    expect(warmAskOf({ ...base, moved: true }, 80, 24)).toBeNull();
    expect(warmAskOf({ ...base, program: "claude" } as never, 80, 24)).toBeNull();
    expect(warmAskOf({ ...base, args: ["-NoLogo"] } as never, 80, 24)).toBeNull();
    expect(warmAskOf({ ...base, env: [["A", "1"]] } as never, 80, 24)).toBeNull();
    expect(warmAskOf({ ...base, typed: "claude" } as never, 80, 24)).toBeNull();
    expect(warmAskOf({ ...base, agent: "codex" }, 80, 24)).toBeNull();
    expect(warmAskOf({ ...base, account: "work" } as never, 80, 24)).toBeNull();
    expect(warmAskOf({ ...base, cwd: null } as never, 80, 24)).toBeNull();
  });
});
