// ONB-024 (FIX-1): the setup card an Explore Kolux stop draws, tested through the real StopSetup.
// There is no DOM test renderer in this repo (see sidebarStart.test.ts), so the component is called
// as a function with settings supplied by a stand-in for useSettings that can answer late; useRef
// is swapped for a slot that survives between draws. The returned element tree is walked for the
// controls, and their handlers are called the way React would call them.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { HOOKS_OFF_HELP } from "../launch/KeepAwakeCard";

const h = { slots: [] as unknown[], i: 0 };
vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  function useRef<T>(init: T) {
    const k = h.i++;
    if (!(k in h.slots)) h.slots[k] = { current: init };
    return h.slots[k] as { current: T };
  }
  return { ...real, useRef, default: { ...real, useRef } };
});

type Settings = Record<string, unknown>;
const hold = { settings: null as Settings | null };
const saves: Settings[] = [];
vi.mock("../settings/useSettings", () => ({
  useSettings: () => ({ settings: hold.settings, error: null, save: (p: Settings) => (saves.push(p), Promise.resolve()) }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.reject(new Error("no host in this test")) }));

type El = { type?: unknown; key?: unknown; props?: Record<string, unknown> };
const kids = (n: unknown): unknown[] => (Array.isArray(n) ? n.flatMap(kids) : n && typeof n === "object" ? [n, ...kids((n as El).props?.children)] : []);
const find = (root: unknown, pred: (e: El) => boolean): El | undefined => kids(root).find((n) => pred(n as El)) as El | undefined;

async function draw(stop: string, taskSource: boolean | null = false) {
  const { StopSetup } = await import("./StepPanels");
  h.i = 0;
  return StopSetup({ stop, taskSource });
}

beforeEach(() => {
  h.slots = [];
  saves.length = 0;
  hold.settings = null;
});

describe("the commit writer card on the Ship stop (FIX-1)", () => {
  test("nothing is drawn until the saved settings have arrived, so there is no box to blank the saved instructions", async () => {
    hold.settings = null;
    expect(await draw("ship")).toBeNull();
    hold.settings = { commitWriterInstructions: "Keep it short." };
    const card = await draw("ship");
    const box = find(card, (e) => e.type === "textarea");
    expect(box?.props?.defaultValue).toBe("Keep it short.");
  });

  test("leaving the box without a change saves nothing; clearing it on purpose does save", async () => {
    hold.settings = { commitWriterInstructions: "Keep it short." };
    const box = find(await draw("ship"), (e) => e.type === "textarea")!;
    (box.props!.onBlur as (e: unknown) => void)({ target: { value: "Keep it short." } });
    expect(saves).toEqual([]);
    (box.props!.onBlur as (e: unknown) => void)({ target: { value: "" } });
    expect(saves).toEqual([{ commitWriterInstructions: "" }]);
  });

  test("the box is rebuilt when the saved instructions change under it", async () => {
    hold.settings = { commitWriterInstructions: "one" };
    const a = find(await draw("ship"), (e) => e.type === "textarea")!;
    hold.settings = { commitWriterInstructions: "two" };
    const b = find(await draw("ship"), (e) => e.type === "textarea")!;
    expect(a.key).not.toEqual(b.key);
    expect(b.props?.defaultValue).toBe("two");
  });

  test("switching the writer off and on again keeps a custom writer custom", async () => {
    hold.settings = { commitWriter: "custom", commitWriterCommand: "my-writer" };
    const sw = (card: unknown) => find(card, (e) => e.props?.role === "switch")!;
    (sw(await draw("ship")).props!.onChange as (e: unknown) => void)({ target: { checked: false } });
    expect(saves.pop()).toEqual({ commitWriter: "off" });
    hold.settings = { commitWriter: "off", commitWriterCommand: "my-writer" };
    (sw(await draw("ship")).props!.onChange as (e: unknown) => void)({ target: { checked: true } });
    expect(saves.pop()).toEqual({ commitWriter: "custom" });
  });

  test("a writer that was off when the card opened comes back as Claude with no command saved, custom with one", async () => {
    const on = async () => {
      const sw = find(await draw("ship"), (e) => e.props?.role === "switch")!;
      (sw.props!.onChange as (e: unknown) => void)({ target: { checked: true } });
      return saves.pop();
    };
    hold.settings = { commitWriter: "off" };
    expect(await on()).toEqual({ commitWriter: "claude" });
    h.slots = [];
    hold.settings = { commitWriter: "off", commitWriterCommand: "my-writer" };
    expect(await on()).toEqual({ commitWriter: "custom" });
  });
});

describe("the keep-awake card on the Agent statuses stop (FIX-1)", () => {
  test("nothing is drawn until the settings have arrived", async () => {
    expect(await draw("statuses")).toBeNull();
  });

  test("Agent mode with the status hooks off shows the same help line as the Settings page", async () => {
    hold.settings = { keepAwake: "agent" };
    const note = find(await draw("statuses"), (e) => e.props?.["data-warn"] === "hooks-off");
    expect(note?.props?.children).toBe(HOOKS_OFF_HELP);
  });

  test("no hooks line with the hooks on, in On mode or while keep-awake is off", async () => {
    for (const s of [{ keepAwake: "agent", agentStatusHooks: true }, { keepAwake: "on" }, { keepAwake: "off" }]) {
      hold.settings = s;
      expect(find(await draw("statuses"), (e) => e.props?.["data-warn"] === "hooks-off")).toBeUndefined();
    }
  });
});

describe("the GitHub card on the tasks and PR stops (FIX-1)", () => {
  test("draws without the settings, and says it is checking while the sign-in is still being read", async () => {
    const card = (await draw("tasks", null)) as El;
    expect(card.props?.["data-connected"]).toBeNull();
    expect(JSON.stringify(card.props?.children)).toMatch(/Checking/);
  });
});

describe("the usage and skill stops hand over to their live cards (T-321-c)", () => {
  test("usage draws the connected-accounts card; orchestration draws its own skill; others do not", async () => {
    const { UsageStop, SkillStop } = await import("./LiveStopCards");
    expect((await draw("usage") as El).type).toBe(UsageStop);
    for (const stop of ["orchestration"]) {
      const el = (await draw(stop)) as El;
      expect(el.type).toBe(SkillStop);
      expect(el.props?.stop).toBe(stop);
    }
    expect(await draw("workspaces")).toBeNull();
  });
});
