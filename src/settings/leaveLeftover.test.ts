// C20-R4-01: a settings field saves on leave, and that save runs in unmount cleanup, so a write that
// GitHub (or the disk) rejects had nowhere to report: the draft died with the component and the error
// was set on a dead one. The text and the reason are now kept in a module-level store and the page
// takes them back on its next mount. The repo has no DOM library, so the components are drawn by
// calling them with a small hook store, as RepoSetupClick.test.ts does.
// @vitest-environment node
import { expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as { deps?: unknown[]; cleanup?: () => void }[],
  ecursor: 0,
  leaves: [] as (() => void)[],
  calls: [] as [string, unknown][],
  fail: {} as Record<string, string>,
  realSetup: false,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => {
    h.calls.push([cmd, args]);
    const why = h.fail[cmd];
    return why ? Promise.reject(why) : Promise.resolve({ id: "p1", name: "app", path: "C:/src/app" });
  },
}));
vi.mock("./RepoSetup", async (orig) => {
  const actual = await orig<typeof import("./RepoSetup")>();
  return { ...actual, default: (p: { path: string }) => (h.realSetup ? actual.default(p) : null) };
});
vi.mock("react", async (orig) => {
  const actual = await orig<typeof import("react")>();
  return {
    ...actual,
    useState: (init: unknown) => {
      const i = h.cursor++;
      if (!(i in h.slots)) h.slots[i] = typeof init === "function" ? (init as () => unknown)() : init;
      const set = (v: unknown) => void (h.slots[i] = typeof v === "function" ? (v as (p: unknown) => unknown)(h.slots[i]) : v);
      return [h.slots[i], set];
    },
    useEffect: (f: () => void | (() => void), deps?: unknown[]) => {
      const i = h.ecursor++;
      const prev = h.effects[i];
      const same = !!prev && !!deps && !!prev.deps && deps.length === prev.deps.length && deps.every((d, j) => Object.is(d, prev.deps![j]));
      if (same) return;
      prev?.cleanup?.();
      const c = f();
      h.effects[i] = { deps, cleanup: typeof c === "function" ? c : undefined };
    },
    useRef: (v: unknown) => ({ current: v }),
    useCallback: (f: unknown) => f,
  };
});
// The real store stays; only the hook that runs the save on unmount is stubbed, so the test can run it.
vi.mock("./leave", async (orig) => {
  const actual = await orig<typeof import("./leave")>();
  return { ...actual, useLeaveSave: (save: () => void) => void h.leaves.push(save), bindLeave: () => () => {} };
});

import RepoPage from "./RepoPage";
import RepoSetupSection from "./RepoSetup";

type El = { type: unknown; props: Record<string, unknown> };
const isEl = (n: unknown): n is El => !!n && typeof n === "object" && "props" in n;
function all(n: unknown, out: El[] = []): El[] {
  if (Array.isArray(n)) n.forEach((c) => all(c, out));
  else if (isEl(n)) {
    if (typeof n.type === "function") all((n.type as (p: Record<string, unknown>) => unknown)(n.props), out);
    else {
      out.push(n);
      all(n.props.children, out);
    }
  }
  return out;
}
const text = (n: unknown): string => (Array.isArray(n) ? n.map(text).join("") : isEl(n) ? text(n.props.children) : typeof n === "string" ? n : "");

const project = { id: "p1", name: "app", path: "C:/src/app", base: "develop" };
const draw = () => {
  h.cursor = 0;
  h.ecursor = 0;
  h.leaves = [];
  return all(RepoPage({ project, onSaved: () => {} }) as unknown);
};
const box = (els: El[], label: string) => els.find((e) => e.type === "input" && e.props["aria-label"] === label);
const unmount = () => {
  h.effects.forEach((e) => e.cleanup?.());
  h.effects = [];
  h.leaves.forEach((f) => f());
};

test("C20-R4-01: text typed before leaving the page comes back with a failed save, and the failure is shown", async () => {
  h.fail = { project_set: "disk full" };
  let els = draw();
  expect(box(els, "New workspaces start from")!.props.value).toBe("develop");
  (box(els, "New workspaces start from")!.props.onChange as (e: unknown) => void)({ target: { value: "wip/base" } });
  els = draw();
  expect(box(els, "New workspaces start from")!.props.value).toBe("wip/base");

  unmount();
  await new Promise((r) => setTimeout(r, 0));
  expect(h.calls.map((c) => c[0]), "the leave save was attempted").toContain("project_set");

  h.slots = [];
  h.fail = {};
  const again = draw();
  expect(box(again, "New workspaces start from")!.props.value, "the typed value comes back").toBe("wip/base");
  expect(again.map(text).join("\n"), "the failure is shown").toContain("could not be saved");
});

test("C20-R4-01: a setup script typed before leaving comes back with the reason its save failed", async () => {
  h.realSetup = true;
  h.slots = [];
  h.effects = [];
  h.calls = [];
  h.fail = { repo_setup_save: "disk full" };
  const setup = { local: "pnpm i", shared: null, sharedError: null, policy: null, inherited: "local", wait: false, suggestBoth: false, runError: null };
  const section = () => {
    h.cursor = 0;
    h.ecursor = 0;
    h.leaves = [];
    return all(RepoSetupSection({ path: "C:/src/app" }) as unknown);
  };
  const area = (els: El[]) => els.find((e) => e.type === "textarea" && e.props["aria-label"] === "Saved setup script");

  // the section reads the setup, then draws the box with what is saved
  section();
  await new Promise((r) => setTimeout(r, 0));
  h.slots[0] = setup;
  let els = section();
  expect(area(els)!.props.value).toBe("pnpm i");
  (area(els)!.props.onChange as (e: unknown) => void)({ target: { value: "pnpm ci" } });
  els = section();
  expect(area(els)!.props.value).toBe("pnpm ci");

  // leaving the page runs the save, and the write is rejected after the section is gone
  h.leaves.forEach((f) => f());
  await new Promise((r) => setTimeout(r, 0));
  expect(h.calls.map((c) => c[0]), "the leave save was attempted").toContain("repo_setup_save");

  h.slots = [];
  h.effects = [];
  h.fail = {};
  section();
  await new Promise((r) => setTimeout(r, 0));
  h.slots[0] = setup;
  const again = section();
  expect(area(again)!.props.value, "the typed script comes back").toBe("pnpm ci");
  expect(again.map(text).join("\n"), "the failure is shown").toContain("could not be saved");
});
