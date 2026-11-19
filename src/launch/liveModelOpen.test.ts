// Job 22 item 3 (job 29 item 2): a Start form already open when Grok's live model list comes back drops a model that
// list lacks, in the parent's state, so the seat asks for a pick and Start waits instead of starting a gone model.
import { act, createElement, useState } from "react";
import type { Root } from "react-dom/client";
import { beforeAll, expect, test, vi } from "vitest";
import { installDom } from "../test/fakeDom";
import type { AgentInfo } from "./PlusMenu";
import { allReady, type Seat } from "./seats";

vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string) => (cmd === "agent_models" ? Promise.resolve([{ id: "grok-a", label: "A" }]) : new Promise(() => {})) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mount: () => Root;
let ChooserPane: typeof import("./ChooserPane").default;
beforeAll(async () => {
  const { doc } = installDom();
  const { createRoot } = await import("react-dom/client");
  ({ default: ChooserPane } = await import("./ChooserPane"));
  mount = () => createRoot(doc.createElement("div") as unknown as Element);
});

const grok: AgentInfo = { id: "grok", name: "Grok", program: "grok", args: [], installed: true, path: null };
const kept: { seats: Seat[] } = { seats: [] };
function Host() {
  const [seats, setSeats] = useState<Seat[]>([{ agent: "grok", model: "grok-gone" }]);
  kept.seats = seats;
  const noop = () => {};
  return createElement(ChooserPane, { number: 1, agents: [grok], seats, onSeats: setSeats, onLineup: noop, shape: "custom", task: "", onTask: noop, onStart: noop, copies: "shared", inGit: false, onCopies: noop, closable: true, onClose: noop, saved: [], onSaved: noop, onPickSaved: noop });
}

test("job 22 item 3: the live list lands while the form is open: a model it lacks goes to null and Start waits", async () => {
  const root = mount();
  act(() => root.render(createElement(Host)));
  expect(kept.seats[0].model).toBe("grok-gone"); // still kept while the search runs (job 13 F6)
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(kept.seats[0]).toEqual({ agent: "grok", model: null });
  expect(allReady(kept.seats)).toBe(false);
  act(() => root.unmount());
});
