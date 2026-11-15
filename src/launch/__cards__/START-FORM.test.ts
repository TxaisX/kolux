// The Start form (Txais 2026-11-15, PLAN T-824): one question for every pane. Folders, How many in each,
// one Which AI / Model / Effort row, the per-seat rows behind "Make each one different", the footer total,
// and "Keep what was open" when it was asked at app open. Rendered to HTML with no browser.
// Third pass (PLAN T-826, job 16): its fixes are tested beside the code: startForm.test.ts (F2), addFolder.test.ts (F1),
// startAcross.test.ts (F3, F8), shell/useStartAsk.test.ts (F4, F5), prefillF7F9.test.ts, liveModelF6.test.ts and
// shell/window/agentsEmpty.test.ts (F15).
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import ChooserPane from "../ChooserPane";
import type { AgentInfo } from "../PlusMenu";
import type { Seat } from "../seats";

const claude: AgentInfo = { id: "claude", name: "Claude Code", program: "claude", args: [], installed: true, path: "C:\bin\claude.exe", docs: true };
const rows = [{ id: "kolux", name: "kolux", path: "G:\Dev\kolux" }, { id: "brain", name: "Txais Brain", path: "G:\Brain" }];
const form = (seats: Seat[], ticked: string[], o: { keepLabel?: string; used?: Record<string, number>; folderRows?: typeof rows } = {}) =>
  renderToString(
    createElement(ChooserPane, {
      number: 1, agents: [claude], seats, onSeats: () => {}, onLineup: () => {}, shape: "custom", task: "", onTask: () => {}, onStart: () => {}, copies: "shared", inGit: true, onCopies: () => {},
      closable: true, onClose: () => {}, saved: [], onSaved: () => {}, onPickSaved: () => {}, sheet: { project: "kolux", path: "G:\Dev\kolux" },
      folders: { rows: o.folderRows ?? rows, ticked, used: o.used ?? {}, onTick: () => {}, onAdd: () => {} }, keepLabel: o.keepLabel,
    }),
  );
const start = (html: string) => html.split("<button").slice(1).find((b) => b.includes(">Start"))!;
const opus = (n: number): Seat[] => Array.from({ length: n }, () => ({ agent: "claude", model: "opus", effort: "high" }));

test("Start form: Folders, How many, one Which AI row, Make each one different closed, and the plain-words total", () => {
  const html = form(opus(3), ["kolux"]);
  expect(html).toContain("<h2>Start</h2>");
  for (const part of ['aria-label="Folders"', ">kolux<", ">Txais Brain<", ">Add folder<", "in each folder", 'aria-label="Which AI"', "Make each one different", "Task for all of them"]) expect(html).toContain(part);
  expect(html).toMatch(/<details class="chooser-each">/); // closed by default
  expect(html).toContain("3 sessions: Claude Code");
  expect(start(html)).not.toContain("disabled");
});

test("Start form: seats that differ show Mixed in the one row", () => {
  const html = form([{ agent: "claude", model: "opus" }, { agent: "claude", model: "sonnet" }], ["kolux"]);
  expect(html.split('aria-label="Which AI"')[1].split('aria-label="Which AI for all of them"')[0]).toContain(">Mixed<");
  expect(html.split('aria-label="Which AI for all of them"')[1].split("</div>")[0]).not.toContain('aria-pressed="true"');
});

test("Start form: two folders double the total; over 24 says so and Start is off", () => {
  expect(form(opus(2), ["kolux", "brain"])).toContain("4 sessions");
  const over = form(opus(13), ["kolux", "brain"]);
  expect(over).toContain("26 sessions is more than 24");
  expect(start(over)).toContain("disabled");
});

test("Start form: no folder ticked or none known keeps Start off and says what to do", () => {
  expect(start(form(opus(1), []))).toContain("disabled");
  const none = form(opus(1), [], { folderRows: [] });
  expect(none).toContain("Add a folder first");
  expect(none).toContain(">Add folder<");
  expect(start(none)).toContain("disabled");
});

test("Start form: asked at app open, the close button reads Keep what was open", () => {
  expect(form(opus(1), ["kolux"], { keepLabel: "Keep what was open" })).toContain(">Keep what was open<");
  expect(form(opus(1), ["kolux"])).toContain(">Cancel<");
});
