// Audit F9 (rest): when a pane closes, its kept Codex account, its kept Codex setup and its "waiting on you" mark
// go with it, so the window's records do not grow with every pane ever opened. The window store does this in one
// effect keyed on the open panes, with the same `forgetGone` the status readings use.
import { expect, test } from "vitest";
import { forgetGone } from "../status/useAgentStatus";
import storeSrc from "./windowStore.ts?raw";

const effect = (() => {
  const at = storeSrc.indexOf("// Audit F9:");
  return at < 0 ? "" : storeSrc.slice(storeSrc.lastIndexOf("useEffect(", at), storeSrc.indexOf("}, [", at) + 30);
})();

test("the window store drops a closed pane's kept account, kept setup and waiting mark", () => {
  expect(effect).toContain("const open = new Set(panes.map((p) => p.key));");
  expect(effect).toContain("setKept((k) => forgetGone(k, open));");
  expect(effect).toContain("setKeptSetup((k) => forgetGone(k, open));");
  expect(effect).toContain("setNeeds((r) => forgetGone(r, open));");
  expect(effect).toContain("}, [panes, setNeeds]);");
});

test("pruning keeps open panes' entries and changes nothing when no pane closed", () => {
  const kept: Record<number, string | null> = { 1: "work", 2: null, 3: "home" };
  const keptSetup: Record<number, string> = { 1: "a", 3: "b" };
  const needs: Record<number, boolean> = { 2: true, 3: false };
  const open = new Set([1, 2]); // pane 3 closed
  expect(forgetGone(kept, open)).toEqual({ 1: "work", 2: null });
  expect(forgetGone(keptSetup, open)).toEqual({ 1: "a" });
  expect(forgetGone(needs, open)).toEqual({ 2: true });
  // Same object back when nothing closed, so React skips the re-render.
  expect(forgetGone(kept, new Set([1, 2, 3]))).toBe(kept);
});
