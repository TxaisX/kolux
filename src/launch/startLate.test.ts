// Job 47 item 1: a Start form opened by the time limit, before the folder list or the agent search came back, follows
// them when they land: the folders get listed and the usual ones ticked, the AIs get listed and fill the blank seats,
// and Terminal can be picked meanwhile.
import { act, createElement, useState } from "react";
import type { Root } from "react-dom/client";
import { beforeAll, expect, test, vi } from "vitest";
import { click, find, installDom } from "../tasks/fakeDom";
import type { AgentInfo } from "./PlusMenu";
import { TERMINAL, type Seat } from "./seats";
import type { FolderRow } from "./startForm";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => new Promise(() => {}) }));

let mount: () => Root;
let doc: ReturnType<typeof installDom>["doc"];
let ChooserPane: typeof import("./ChooserPane").default;
beforeAll(async () => {
  ({ doc } = installDom());
  const { createRoot } = await import("react-dom/client");
  ({ default: ChooserPane } = await import("./ChooserPane"));
  mount = () => createRoot(doc.createElement("div") as unknown as Element);
});

const claude: AgentInfo = { id: "claude", name: "Claude Code", program: "claude", args: [], installed: true, path: "C:\bin\claude.exe" };
const rowsIn: FolderRow[] = [{ id: "a", name: "alpha", path: "C:\a" }, { id: "b", name: "beta", path: "C:\b" }];
const seen: { seats: Seat[]; ticked: string[]; set: (late: { rows: FolderRow[]; agents: AgentInfo[]; detecting: boolean }) => void } = { seats: [], ticked: [], set: () => {} };
function Host() {
  const [seats, setSeats] = useState<Seat[]>([{ agent: null, model: null }, { agent: null, model: null }]);
  const [ticked, setTicked] = useState<string[]>([]);
  const [late, setLate] = useState({ rows: [] as FolderRow[], agents: [] as AgentInfo[], detecting: true });
  Object.assign(seen, { seats, ticked, set: setLate });
  const noop = () => {};
  return createElement(ChooserPane, {
    number: 1, agents: late.agents, detecting: late.detecting, seats, onSeats: setSeats, onLineup: noop, shape: "custom", task: "", onTask: noop, onStart: noop, copies: "shared", inGit: false, onCopies: noop, closable: true, onClose: noop, saved: [], onSaved: noop, onPickSaved: noop,
    defaultAgent: "claude", seatDefault: { model: "opus", effort: "" }, sheet: { project: "", path: "" },
    folders: { rows: late.rows, ticked, used: {}, onTick: setTicked, onAdd: noop, usual: ["b"] },
  });
}

test("job 47: the folder list and the agent search land after the form opened: the usual folder is ticked and the seats fill", () => {
  const root = mount();
  act(() => root.render(createElement(Host)));
  expect(seen.ticked).toEqual([]);
  act(() => seen.set({ rows: rowsIn, agents: [], detecting: true }));
  expect(seen.ticked).toEqual(["b"]);
  act(() => seen.set({ rows: rowsIn, agents: [claude], detecting: false }));
  expect(seen.seats.map((s) => s.agent)).toEqual(["claude", "claude"]);
  act(() => root.unmount());
});

test("job 47: while the agent search runs, Terminal can be picked, and the pick stays when the search answers", async () => {
  const box = doc.createElement("div");
  const root = (await import("react-dom/client")).createRoot(box as unknown as Element);
  act(() => root.render(createElement(Host)));
  const term = find(box, (n) => n.attrs["data-testid"] === "seat-agent-terminal")[0];
  expect(term).toBeTruthy();
  await click(box, term!);
  expect(seen.seats.map((s) => s.agent)).toEqual([TERMINAL, TERMINAL]);
  act(() => seen.set({ rows: rowsIn, agents: [claude], detecting: false }));
  expect(seen.seats.map((s) => s.agent)).toEqual([TERMINAL, TERMINAL]);
  act(() => root.unmount());
});
