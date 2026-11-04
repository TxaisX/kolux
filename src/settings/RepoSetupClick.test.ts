// SET-033 / PROJ-035: clicks on the repository's setup section. The repo has no DOM library, so the
// component is drawn by calling it with a small hook store and each button's own onClick is called.
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
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
    useEffect: () => {},
    useRef: (v: unknown) => ({ current: v }),
    useCallback: (f: unknown) => f,
  };
});

import { RepoSetupView } from "./RepoSetup";
import type { RepoSetup } from "./setupChoice";

type El = { type: unknown; props: Record<string, unknown> };
const isEl = (n: unknown): n is El => !!n && typeof n === "object" && "props" in n;
function all(n: unknown, out: El[] = []): El[] {
  if (Array.isArray(n)) n.forEach((c) => all(c, out));
  else if (isEl(n)) {
    out.push(n);
    all(n.props.children, out);
  }
  return out;
}
const text = (n: unknown): string => (Array.isArray(n) ? n.map(text).join("") : isEl(n) ? text(n.props.children) : typeof n === "string" || typeof n === "number" ? String(n) : "");

const saved: RepoSetup = { local: "pnpm i", shared: null, sharedError: null, policy: null, inherited: "local", wait: false, suggestBoth: false, runError: null };

let calls: string[] = [];
const actions = {
  onSave: (s: string) => void calls.push(`save:${s}`),
  onRemove: () => void calls.push("remove"),
  onChoice: (v: string) => void calls.push(`choice:${v}`),
  onWait: (w: boolean) => void calls.push(`wait:${w}`),
  onUntrust: () => void calls.push("untrust"),
};
const draw = (setup: RepoSetup = saved) => {
  h.cursor = 0;
  return all(RepoSetupView({ setup, actions }));
};
const button = (els: El[], label: string) => els.find((e) => e.type === "button" && text(e) === label);
const press = (label: string) => {
  const b = button(draw(), label);
  if (!b) throw new Error(`no "${label}" button on the page`);
  (b.props.onClick as () => void)();
};

beforeEach(() => {
  h.slots = [];
  h.cursor = 0;
  calls = [];
});

test("AFTER: Remove asks first; Keep it leaves the saved setup, Remove it takes it away", () => {
  expect(button(draw(), "Remove it")).toBeUndefined();
  press("Remove");
  const asking = draw();
  expect(button(asking, "Remove it") && button(asking, "Keep it"), "both answers show").toBeTruthy();
  expect(button(asking, "Remove"), "the first button is replaced by the two answers").toBeUndefined();
  expect(calls, "asking removes nothing").toEqual([]);
  press("Keep it");
  expect(calls).toEqual([]);
  expect(button(draw(), "Remove"), "back to the single Remove").toBeTruthy();
  press("Remove");
  press("Remove it");
  expect(calls).toEqual(["remove"]);
  expect(button(draw(), "Remove"), "the question closes after the answer").toBeTruthy();
});

test("AFTER: blanking the box saves nothing, says to use Remove, and puts the saved setup back in the box", () => {
  const box = () => draw().find((e) => e.type === "textarea")!;
  expect(box().props.value).toBe("pnpm i");
  (box().props.onChange as (e: unknown) => void)({ target: { value: "" } });
  expect(box().props.value, "typing shows what was typed").toBe("");
  (box().props.onBlur as () => void)();
  expect(calls, "an emptied box is not a save").toEqual([]);
  const els = draw();
  expect(els.map((e) => text(e)).some((t) => t.includes("To take the saved setup away, use Remove.")), "the hint shows").toBe(true);
  expect(els.find((e) => e.type === "textarea")!.props.value, "the box shows the setup that is still saved").toBe("pnpm i");
});

test("AFTER: a changed draft saves on blur", () => {
  const box = () => draw().find((e) => e.type === "textarea")!;
  (box().props.onChange as (e: unknown) => void)({ target: { value: "pnpm ci" } });
  (box().props.onBlur as () => void)();
  expect(calls).toEqual(["save:pnpm ci"]);
});

test("T-721: what is trusted shows with Stop trusting; once stopped the row goes and kolux.yaml asks first again", () => {
  const yaml: RepoSetup = { ...saved, local: null, shared: "pnpm i", inherited: "shared" };
  const page = (s: RepoSetup) => draw(s).map((e) => text(e)).join("\n");
  expect(button(draw(yaml), "Stop trusting"), "nothing trusted: no row").toBeUndefined();
  expect(page(yaml)).toContain("asks first, once, and again if it changes");
  const always = draw({ ...yaml, trustedAll: true, trusted: ["setup"] });
  expect(always.map((e) => text(e)).join("\n")).toContain("Always trust is on: every script in kolux.yaml runs without asking");
  (button(always, "Stop trusting")!.props.onClick as () => void)();
  expect(calls).toEqual(["untrust"]);
  expect(page({ ...yaml, trusted: ["setup", "issue"] })).toContain("Runs without asking while unchanged: the setup script, the issue command.");
  // the page reads back after the write; Rust's t721 test shows the record is gone and each script asks again
  expect(button(draw({ ...yaml, trustedAll: false, trusted: [] }), "Stop trusting")).toBeUndefined();
});
