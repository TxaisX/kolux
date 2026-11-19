// Job 50 item 2 (A5): when the live model list drops a model the form had, the form says which AI no longer
// offers which model, one line per pair, until no seat of that AI is left without a model.
import { act, createElement, useState } from "react";
import type { Root } from "react-dom/client";
import { beforeAll, expect, test, vi } from "vitest";
import { click, find, installDom, type FakeNode } from "../test/fakeDom";
import type { AgentInfo } from "./PlusMenu";
import type { Seat } from "./seats";

vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string) => (cmd === "agent_models" ? Promise.resolve([{ id: "grok-a", label: "A" }, { id: "grok-b", label: "B" }]) : new Promise(() => {})) }));

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

// Job 57 F4: a pair is forgotten when the user picks that AI again, so a fresh pick that never had the model
// (seatStart gives no model when the AI lists several and none is saved) shows no old line.
const claude: AgentInfo = { id: "claude", name: "Claude", program: "claude", args: [], installed: true, path: null };
function OneSeat() {
  const [seats, setSeats] = useState<Seat[]>([{ agent: "grok", model: "grok-old" }]);
  live.seats = seats;
  live.set = setSeats;
  const noop = () => {};
  return createElement(ChooserPane, { number: 1, agents: [claude, grok], seats, onSeats: setSeats, onLineup: noop, shape: "custom", task: "", onTask: noop, onStart: noop, copies: "shared", inGit: false, onCopies: noop, closable: true, onClose: noop, saved: [], onSaved: noop, onPickSaved: noop });
}
const line = "Grok no longer offers grok-old. Pick another.";

async function dropped() {
  const { createRoot } = await import("react-dom/client");
  const box = doc.createElement("div") as unknown as Element;
  const root: Root = createRoot(box);
  act(() => root.render(createElement(OneSeat)));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(live.seats[0].model).toBeNull();
  expect(box.textContent, "the plain case still shows the line").toContain(line);
  const node = box as unknown as FakeNode;
  const button = (group: string, id: string) => find(node, (n) => n.attrs["data-testid"] === group)[0] && find(find(node, (n) => n.attrs["data-testid"] === group)[0], (n) => n.attrs["data-testid"] === `seat-agent-${id}`)[0];
  const pick = (group: string, id: string) => act(async () => void (await click(node, button(group, id))));
  return { box, root, pick };
}

test("job 57 F4: switching all seats to another AI and back to Grok shows no old line", async () => {
  const { box, root, pick } = await dropped();
  await pick("all-agents", "claude");
  expect(live.seats[0].agent).toBe("claude");
  expect(box.textContent).not.toContain("no longer offers");
  await pick("all-agents", "grok");
  expect(live.seats[0]).toMatchObject({ agent: "grok", model: null });
  expect(box.textContent).not.toContain("no longer offers");
  act(() => root.unmount());
});

test("job 57 F4: the same through one seat's own AI buttons", async () => {
  const { box, root, pick } = await dropped();
  await pick("seat-1-agents", "claude");
  await pick("seat-1-agents", "grok");
  expect(live.seats[0]).toMatchObject({ agent: "grok", model: null });
  expect(box.textContent).not.toContain("no longer offers");
  act(() => root.unmount());
});

// Job 68 F3: Grok's saved pick names a model its live list dropped. Picking Grok again never brings it back:
// the saved pick is read through clean (chat/controls.ts loadSaved), which checks the same list knownModel does.
test("job 68 F3: a saved model the AI no longer offers is not restored when the AI is picked again", async () => {
  const g = globalThis as { localStorage?: Storage };
  g.localStorage = (window as unknown as { localStorage: Storage }).localStorage; // the saved picks read the global
  g.localStorage.setItem("kolux.chat.launchChoices", JSON.stringify({ grok: { model: "grok-old" } }));
  try {
    const { root, pick } = await dropped();
    await pick("seat-1-agents", "claude");
    await pick("seat-1-agents", "grok");
    expect(live.seats[0]).toMatchObject({ agent: "grok", model: null });
    await pick("all-agents", "claude");
    await pick("all-agents", "grok");
    expect(live.seats[0]).toMatchObject({ agent: "grok", model: null });
    // Control: a saved model the list still has does come back, so the saved pick really is read here.
    g.localStorage.setItem("kolux.chat.launchChoices", JSON.stringify({ grok: { model: "grok-b" } }));
    await pick("seat-1-agents", "claude");
    await pick("seat-1-agents", "grok");
    expect(live.seats[0]).toMatchObject({ agent: "grok", model: "grok-b" });
    act(() => root.unmount());
  } finally {
    g.localStorage.removeItem("kolux.chat.launchChoices");
    delete g.localStorage;
  }
});
