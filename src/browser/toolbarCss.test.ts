// T-767: the import-logins hint names browsers, so it cannot be a 24 px icon button: at that width its text ran
// out of the box and painted over the chip beside it. The stylesheet must give the label its own width, an
// ellipsis, room to shrink, and a narrow pane must drop it so the toolbar stays usable and the chip clickable.
import { describe, expect, it } from "vitest";
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const css = nodeFs.readFileSync(new URL("./browser.css", import.meta.url), "utf8");

/** The first rule for `selector` (the base rule, before any container query). */
function rule(selector: string) {
  const at = css.indexOf(`${selector} {`);
  const end = css.indexOf("}", at);
  return at < 0 || end < 0 ? "" : css.slice(at, end);
}

describe("T-767: the import-logins hint stays inside the toolbar", () => {
  it("the hint can shrink instead of covering its neighbours", () => {
    const hint = rule(".pane.browser .pane-head .import-hint");
    expect(hint).toMatch(/flex:\s*0 1 auto/);
    expect(hint).toMatch(/min-width:\s*0/);
  });

  it("the label sizes to its text and truncates with an ellipsis", () => {
    const label = rule(".pane.browser .pane-head .import-hint > .ib:first-child");
    expect(label).toMatch(/width:\s*auto/);
    expect(label).toMatch(/max-width:\s*\d+px/);
    expect(label).toMatch(/overflow:\s*hidden/);
    expect(label).toMatch(/text-overflow:\s*ellipsis/);
    expect(label).toMatch(/white-space:\s*nowrap/);
  });

  it("a narrow pane drops the hint, while the Import cookies button stays in the toolbar", () => {
    expect(css).toMatch(/@container \(max-width: \d+px\) \{\s*\n\s*\.pane\.browser \.pane-head \.import-hint \{ display: none; \}/);
    expect(css).not.toMatch(/\.pane\.browser \.pane-head \.cookies[^}]*display:\s*none/);
  });
});
