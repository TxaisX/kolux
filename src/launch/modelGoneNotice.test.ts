// Job 50 item 2 (A5): when the live model list drops a model the form had, the form says which AI no longer
// offers which model, one line per pair, until no seat of that AI is left without a model.
import { act, createElement, useState } from "react";
import type { Root } from "react-dom/client";
import { beforeAll, expect, test, vi } from "vitest";
import { installDom } from "../tasks/fakeDom";
import type { AgentInfo } from "./PlusMenu";
import type { Seat } from "./seats";

vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string) => (cmd === "agent_models" ? Promise.resolve([{ id: "grok-a", label: "A" }]) : new Promise(() => {})) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let doc: Document;
let ChooserPane: typeof import("./ChooserPane").default;
beforeAll(async () => {
  ({ doc } = installDom() as unknown as { doc: Document });
  ({ default: ChooserPane } = await import("./ChooserPane"));
});

const grok: AgentInfo = { id: "grok", name: "Grok", program: "grok", args: [], installed: true, path: null };
const live: { seats: Seat[]; set: (s: Seat[]) => void } = { seats: [], set: () => {} };
function Host() {
  const [seats, setSeats] = useState<Seat[]>([
    { agent: "grok", model: "grok-gone" },
    { agent: "grok", model: "grok-gone" },
    { agent: "grok", model: "grok-old" },
  ]);
  live.seats = seats;
  live.set = setSeats;
  const noop = () => {};
  return createElement(ChooserPane, { number: 1, agents: [grok], seats, onSeats: setSeats, onLineup: noop, shape: "custom", task: "", onTask: noop, onStart: noop, copies: "shared", inGit: false, onCopies: noop, closable: true, onClose: noop, saved: [], onSaved: noop, onPickSaved: noop });
}
const count = (text: string, line: string) => text.split(line).length - 1;

test("job 50 A5: a model the AI no longer offers is named once per pair, and the line goes when every seat has a model again", async () => {
  const { createRoot } = await import("react-dom/client");
  const box = doc.createElement("div") as unknown as Element;
  const root: Root = createRoot(box);
  act(() => root.render(createElement(Host)));
  expect(box.textContent).not.toContain("no longer offers");
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(live.seats.map((s) => s.model)).toEqual([null, null, null]);
  const text = box.textContent ?? "";
  expect(count(text, "Grok no longer offers grok-gone. Pick another.")).toBe(1);
  expect(count(text, "Grok no longer offers grok-old. Pick another.")).toBe(1);
  // One seat picks a model: another Grok seat still has none, so the lines stay.
  act(() => live.set(live.seats.map((s, i) => (i === 0 ? { ...s, model: "grok-a" } : s))));
  expect(box.textContent).toContain("Grok no longer offers grok-gone. Pick another.");
  // Every Grok seat has a model again: the lines go.
  act(() => live.set(live.seats.map((s) => ({ ...s, model: "grok-a" }))));
  expect(box.textContent).not.toContain("no longer offers");
  act(() => root.unmount());
});
