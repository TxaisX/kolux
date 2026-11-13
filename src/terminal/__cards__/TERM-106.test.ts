// TERM-106 box 2: a tab the user closed on purpose before the crash does not come back. The saved layout is what a restart
// rebuilds the tabs from; it is written (debounced) from the live tabs after the close, and read back by restoreLayout.
// MIRROR src/App.tsx:2041 dropPanes (`setPanes(ps => ps.filter(not closed))`) and App.tsx:1568 (layoutOf of the live panes ->
// layoutWriter.set): the decision that the closed tab is absent lives in layoutOf / layoutWriter / restoreLayout (imported).
import { expect, test } from "vitest";
import { layoutOf, restoreLayout } from "../layout";
import { layoutWriter } from "../layoutSave";

const shell = (key: number, cwd: string | null) => ({ key, cwd, branch: null, agent: "shell" as const, program: null, args: [] });

test("a tab closed on purpose is not in the layout written before the crash, and a restart rebuilds only the others", () => {
  const timers: { f: () => void }[] = [];
  const written: unknown[] = [];
  const writer = layoutWriter((l) => written.push(JSON.parse(JSON.stringify(l))), 400, { set: (f) => (timers.push({ f }), timers.length), clear: () => {} });
  let panes = [shell(1, null), shell(2, "C:\\w\\a"), shell(3, "C:\\w\\a")];
  writer.set(layoutOf(panes, 3, "C:\\w\\a", {}));
  timers.pop()!.f(); // the quiet moment passes: the three tabs are written down
  expect((written[0] as { panes: { key: number }[] }).panes.map((p) => p.key)).toEqual([1, 2, 3]);

  // the user closes tab 3 (focused) on purpose; focus moves to its neighbour, as dropPanes does
  panes = panes.filter((p) => p.key !== 3);
  writer.set(layoutOf(panes, 2, "C:\\w\\a", {}));
  timers.pop()!.f(); // written; then the app crashes
  expect(written).toHaveLength(2);

  const back = restoreLayout(written[1])!;
  expect(back.panes.map((p) => p.key)).toEqual([1, 2]);
  expect(back.focused).toBe(2);
  expect(JSON.stringify(written[1])).not.toContain('"key":3');
});
