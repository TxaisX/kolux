// SESS-007 box 3: a chooser that is the grid's only pane has no close button; beside another pane it has one;
// the Start form (the sheet) keeps its own close button. The decision (chooserClosable) is real product code; the
// rendered button is the real ChooserPane. App.tsx only passes the shown-pane count (MIRROR App.tsx renderChooser callers).
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import ChooserPane from "../../launch/ChooserPane";
import { chooserClosable } from "../../launch/chooserClosable";
import type { AgentInfo } from "../../launch/PlusMenu";
import { defaultCopies, emptySeat } from "../../launch/seats";

const claude: AgentInfo = { id: "claude", name: "Claude Code", program: "claude", args: [], installed: true, path: "C:\bin\claude.exe", docs: true };
const render = (shown: number, sheet: { project: string; path: string } | null) => {
  const seats = [emptySeat()];
  return renderToString(
    createElement(ChooserPane, { number: 2, agents: [claude], seats, onSeats: () => {}, onLineup: () => {}, shape: "custom", task: "", onTask: () => {}, onStart: () => {}, copies: defaultCopies(1, true), inGit: true, onCopies: () => {}, closable: chooserClosable(shown, sheet !== null), onClose: () => {}, sheet, saved: [] } as never),
  );
};

test("SESS-007 b3: a lone grid chooser has no Close this chooser button", () => {
  expect(render(1, null)).not.toContain("Close this chooser");
});

test("SESS-007 b3: a chooser beside another pane has the Close this chooser button", () => {
  expect(render(2, null)).toContain("Close this chooser");
});

test("SESS-007 b3: the Start form keeps its close button even with no other pane", () => {
  const html = render(1, { project: "demo", path: "C:\demo" });
  expect(html).toContain("Close Start");
  expect(chooserClosable(1, true)).toBe(true);
});
