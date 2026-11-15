// Job 29 R1: on a slow start (settings read over 1.5 s) the window is drawn with no saved tabs, then drawn again with
// `read` true and the saved layout in `late`. The store says "the saved layout is in" (`layoutIn`) in the same state
// update that joins the saved panes, so the Start form never takes the restored panes for panes the user added.
import { act, createElement, useLayoutEffect } from "react";
import type { Root } from "react-dom/client";
import { beforeAll, expect, test, vi } from "vitest";
import { installDom } from "../tasks/fakeDom";
import type { SavedLayout, SavedPane } from "../terminal/layout";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => new Promise(() => {}), Channel: class {}, convertFileSrc: (p: string) => p }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mount: () => Root;
let useWindowStore: typeof import("./windowStore").useWindowStore;
beforeAll(async () => {
  const { doc } = installDom();
  const d = doc as unknown as Record<string, unknown>;
  d.hasFocus ??= () => true;
  const { createRoot } = await import("react-dom/client");
  ({ useWindowStore } = await import("./windowStore"));
  mount = () => createRoot(doc.createElement("div") as unknown as Element);
});

const pane = (key: number): SavedPane => ({ key, cwd: "C:\\work", branch: null, agent: "shell", program: null, args: [] }) as unknown as SavedPane;
const saved: SavedLayout = { panes: [pane(1), pane(2), pane(3)], activeTab: {}, focused: 1, activeDir: null, stacked: {} };

type Seen = { layoutIn: boolean; panes: number };
function Probe({ read, late, seen }: { read: boolean; late: SavedLayout | null; seen: Seen[] }) {
  const s = useWindowStore({}, null, late, read) as unknown as { layoutIn: boolean; panes: unknown[] };
  useLayoutEffect(() => void seen.push({ layoutIn: s.layoutIn, panes: s.panes.length }));
  return null;
}

test("R1: a late layout with 3 panes: no committed render has the layout in while the panes are still 0", () => {
  const seen: Seen[] = [];
  const root = mount();
  act(() => root.render(createElement(Probe, { read: false, late: null, seen })));
  expect(seen[seen.length - 1]).toEqual({ layoutIn: false, panes: 0 });
  act(() => root.render(createElement(Probe, { read: true, late: saved, seen })));
  expect(seen.filter((r) => !r.layoutIn && r.panes > 0)).toEqual([]); // job 43 F3: the saved tabs never land before layoutIn
  expect(seen.filter((r) => r.layoutIn && r.panes === 0)).toEqual([]);
  expect(seen[seen.length - 1]).toEqual({ layoutIn: true, panes: 3 });
  act(() => root.unmount());
});

test("R1 case (c): a late draw with no saved layout still says the layout is in, with 0 panes", () => {
  const seen: Seen[] = [];
  const root = mount();
  act(() => root.render(createElement(Probe, { read: false, late: null, seen })));
  act(() => root.render(createElement(Probe, { read: true, late: null, seen })));
  expect(seen[seen.length - 1]).toEqual({ layoutIn: true, panes: 0 });
  act(() => root.unmount());
});

test("R1 case (a): a fast start has the layout in from the first render", () => {
  const seen: Seen[] = [];
  const root = mount();
  act(() => root.render(createElement(Probe, { read: true, late: null, seen })));
  expect(seen[0]).toEqual({ layoutIn: true, panes: 0 });
  act(() => root.unmount());
});
