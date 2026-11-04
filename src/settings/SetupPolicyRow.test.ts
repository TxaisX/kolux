// C20-R1-01: the global "Which setup runs" row reads and saves the kv the runner reads. The repo has
// no DOM library, so the component is drawn by calling it with a small hook store and the select's
// own onChange is called (the pattern in RepoSetupClick.test.ts).
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, calls: [] as [string, unknown][], reply: {} as Record<string, unknown> }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => (h.calls.push([cmd, args]), Promise.resolve(h.reply[cmd])),
}));
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
    useEffect: (f: () => unknown) => void f(),
  };
});

import SetupPolicyRow, { SetupPolicyView } from "./SetupPolicyRow";

type El = { type: (p: Record<string, unknown>) => unknown; props: Record<string, unknown> };
const isEl = (n: unknown): n is El => !!n && typeof n === "object" && "props" in n && "type" in n;
function all(n: unknown, out: El[] = []): El[] {
  if (Array.isArray(n)) n.forEach((c) => all(c, out));
  else if (isEl(n)) {
    out.push(n);
    all(n.props.children, out);
  }
  return out;
}

beforeEach(() => {
  h.slots = [];
  h.cursor = 0;
  h.calls = [];
  h.reply = {};
});

test("C20-R1-01: the global row saves the key the runner reads, and nothing else", () => {
  const host = SetupPolicyRow() as unknown as El;
  expect(h.calls).toContainEqual(["setup_policy_get", undefined]);
  const tree = host.type(host.props);
  const select = all(tree).find((e) => e.props["aria-label"] === "which setup runs");
  expect(select).toBeTruthy();
  (select!.props.onChange as (e: unknown) => void)({ target: { value: "both" } });
  expect(h.calls).toContainEqual(["setup_policy_set", { policy: "both" }]);
  expect(h.calls.some(([cmd]) => cmd === "settings_patch"), "the row never writes settings.json").toBe(false);
});

test("C20-R1-01: the select shows the stored policy, and nothing stored is the local default", () => {
  const select = all(SetupPolicyView({ stored: "shared", onChoose: () => {} })).find((e) => e.props["aria-label"] === "which setup runs");
  expect(select!.props.value).toBe("shared");
  const resent = all(SetupPolicyView({ stored: null, onChoose: () => {} })).find((e) => e.props["aria-label"] === "which setup runs");
  expect(resent!.props.value).toBe("local");
});
