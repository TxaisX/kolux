// T-694 (F13, F16, F17; DT-C130): the stylesheet rules the Wave 3 live run found broken. The floating panel and its
// button sit under a modal's scrim, so a dialog's Cancel is never covered, but still over the plan sheet and pages; the
// chooser footer's buttons wrap in a narrow pane instead of running past its edge.
import { expect, test } from "vitest";

// Vitest returns "" for a .css import, so the stylesheets are read from disk (the project carries no Node types).
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const css = nodeFs.readFileSync(new URL("../styles.css", import.meta.url), "utf8") + nodeFs.readFileSync(new URL("./floating.css", import.meta.url), "utf8");
const rule = (sel: string): string => {
  const m = css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  expect(m, sel).not.toBeNull();
  return m![1];
};
const z = (sel: string) => Number(rule(sel).match(/z-index:\s*(\d+)/)![1]);

test("T-694: a modal's scrim covers the floating panel and its button; both stay over the plan sheet", () => {
  for (const sel of [".float-panel", ".float-btn"]) {
    expect(z(sel), sel).toBeLessThan(z(".scrim"));
    expect(z(sel), sel).toBeGreaterThan(z(".plan-sheet"));
  }
  expect(z(".float-btn")).toBeGreaterThan(z(".float-panel"));
});

test("T-694: the chooser footer's buttons wrap rather than clip", () => {
  expect(rule(".chooser-foot .btn-row")).toMatch(/flex-wrap:\s*wrap/);
});
