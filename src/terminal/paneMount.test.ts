// Review 0.2.0, FT-2..FT-5: what TerminalPane's mount effect does before its terminal is bound. The pane is not
// drawn in tests (xterm needs a real canvas), so these read its source, as handover.test.ts does.
import { expect, test } from "vitest";
import pane from "./TerminalPane.tsx?raw";

const between = (from: string, to: string): string => {
  const a = pane.indexOf(from);
  const b = pane.indexOf(to, a + from.length);
  expect(a, from).toBeGreaterThan(-1);
  expect(b, to).toBeGreaterThan(a);
  return pane.slice(a, b);
};

test("FT-2: a pane mounted focused takes the keyboard right after its terminal opens, not when its start answers", () => {
  const opened = between("termRef.current = term;", "const gpuSoon");
  expect(opened).toMatch(/if \(isFocused\.current && !isHidden\.current\) term\.focus\(\);/);
});

test("FT-3: the first-paint GPU wake is skipped while the pane is hidden, and a shown mount is not reported as shown", () => {
  const soon = between("const gpuSoon = afterPaint(() => {", "choice.onFallback");
  expect(soon.indexOf("isHidden.current")).toBeGreaterThan(-1);
  expect(soon.indexOf("isHidden.current")).toBeLessThan(soon.indexOf("choice.wake()"));
  expect(pane).not.toContain("parking.current.hidden(isHidden.current);");
  expect(pane).toContain("if (isHidden.current) parking.current.hidden(true);");
});

test("FT-4: a resize to the size already sent is not sent again, and a newly bound id hears its size", () => {
  const resize = between("const resize = () => {", "const observer = new ResizeObserver");
  expect(resize).toMatch(/if \(!sizes\.send\(id, cols, rows\)\) return;/);
  expect(resize).toMatch(/\.catch\(\(\) => sizes\.failed\(id, cols, rows\)\)/);
  const bind = between("idRef.current = id;", "if (needsSize(back)) resize();");
  expect(bind).toContain("sizes.reset();");
});

test("FT-5: before the id is known, only chunks tagged with this pane (or untagged) are held for the bind", () => {
  const route = between("forPane(e, null, number)) draw();", '"pane-agent"');
  expect(route).toMatch(/else if \(idRef\.current !== null \|\| holdsBeforeBind\(e, number\)\) mine\(e\.id, draw\);/);
});
