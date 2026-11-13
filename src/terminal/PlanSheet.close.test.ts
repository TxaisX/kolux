import { expect, test, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

// T-032-b (stand-in review FIX-SOON 3): the sheet's Close button and Esc are wired to the job, so a
// pending send is cancelled rather than left running with its Cancel gone. React is called
// directly here (one render, effects run by hand) so the real handlers can be clicked without a DOM.
const effects: (() => void | (() => void))[] = [];
vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  return {
    ...real,
    useState: <T,>(v: T | (() => T)) => [typeof v === "function" ? (v as () => T)() : v, () => {}],
    useMemo: <T,>(f: () => T) => f(),
    useEffect: (f: () => void | (() => void)) => void effects.push(f),
  };
});
vi.mock("../editor/PreviewPane", () => ({ renderMarkdown: (md: string) => md }));
const { default: PlanSheet } = await import("./PlanSheet");

type El = ReactElement<{ children?: ReactNode; onClick?: () => void }>;
const find = (n: ReactNode, label: string): El | null => {
  if (n === null || typeof n !== "object") return null;
  if (Array.isArray(n)) return n.map((c) => find(c, label)).find(Boolean) ?? null;
  const e = n as El;
  if (e.type === "button" && e.props.children === label) return e;
  return find(e.props.children, label);
};

// The sheet is a src/ui Dialog (not modal): its Escape is the layer's and lands in the Dialog's onClose("escape"); a
// press outside lands there as "outside" and leaves the sheet open, as the terminal beside it stays usable.
const open = (sending: boolean) => {
  const calls: string[] = [];
  effects.length = 0;
  const tree = PlanSheet({
    title: "Claude 1",
    plan: "Step one.",
    draft: { comments: [], note: "tighten it" },
    onDraft: () => {},
    onApprove: () => calls.push("approve"),
    onRequest: () => calls.push("request"),
    onClose: () => calls.push("close"),
    sending,
    onCancel: () => calls.push("cancel"),
  }) as ReactNode;
  for (const f of effects) f();
  const dialog = (tree as ReactElement<{ onClose: (why: string) => void }>).props;
  return { calls, tree, esc: () => dialog.onClose("escape"), outside: () => dialog.onClose("outside") };
};

test("T-032-b: Close while a send waits cancels the send first, then closes (SAFE-004)", () => {
  const s = open(true);
  find(s.tree, "Close")?.props.onClick?.();
  expect(s.calls).toEqual(["cancel", "close"]);
});

test("T-032-b: Esc while a send waits cancels the send first, then closes (SAFE-004)", () => {
  const s = open(true);
  s.esc();
  expect(s.calls).toEqual(["cancel", "close"]);
});

test("T-032-b: with nothing pending, Close and Esc only close (SAFE-004); a press outside the sheet leaves it open", () => {
  const s = open(false);
  find(s.tree, "Close")?.props.onClick?.();
  s.esc();
  s.outside();
  expect(s.calls).toEqual(["close", "close"]);
});
