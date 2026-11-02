// T-566: the pane reader live-T-544.mjs runs inside the app's page after a relaunch. No DOM library is installed, so
// the document here is a hand-rolled stub: querySelectorAll answers the two selectors the reader uses with objects that
// carry getAttribute, dataset, querySelector and offsetParent, the way real elements do.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { paneStates } from "./pane-states.mjs";

const TERM = "section.pane[data-agent]";
const ROWS = ".sess.pane-row[data-pane]";

/** A terminal pane box: title = its aria-label minus " pane"; key = its data-key (absent when null). */
const pane = ({ title, key = null, restored = null, hidden = false }) => ({
  offsetParent: hidden ? null : {},
  dataset: key === null ? {} : { key: String(key) },
  getAttribute: (n) => (n === "aria-label" ? `${title} pane` : null),
  querySelector: (s) => (s === ".status.restored" && restored !== null ? { textContent: `  ${restored}  ` } : null),
});
/** A sidebar row (ProjectsPanel pane-row): title "Show <pane title>", data-pane = the pane key. */
const row = (title, key) => ({ title: `Show ${title}`, dataset: { pane: String(key) } });
const doc = (panes, rows = []) => ({ querySelectorAll: (s) => (s === TERM ? panes : s === ROWS ? rows : []) });

// The reader is sent to the page as text, (${paneStates.toString()})(document, TERM): it must not lean on anything
// from this module's scope, so every case here calls it the same way the prover does.
const read = (document) => new Function("document", "sel", `return (${paneStates.toString()})(document, sel)`)(document, TERM);

describe("paneStates (scripts/prove/pane-states.mjs)", () => {
  it("a pane with data-key reports that key with no sidebar row at all, and its restored chip's text", () => {
    expect(read(doc([pane({ title: "Terminal 7", key: 7, restored: "restored" })]))).toEqual([{ i: 0, title: "Terminal 7", key: "7", restored: "restored" }]);
  });

  it("the pane's own data-key wins over a sidebar row that says otherwise", () => {
    expect(read(doc([pane({ title: "Terminal 2", key: 2 })], [row("Terminal 2", 9)]))).toEqual([{ i: 0, title: "Terminal 2", key: "2", restored: null }]);
  });

  it("a pane without data-key falls back to its sidebar row's data-pane, matched by title", () => {
    const d = doc([pane({ title: "Terminal 3", restored: "restored without resume" })], [row("Terminal 1", 1), row("Terminal 3", 3)]);
    expect(read(d)).toEqual([{ i: 0, title: "Terminal 3", key: "3", restored: "restored without resume" }]);
  });

  it("a pane with neither reports key null; a chip that is not there reads null", () => {
    expect(read(doc([pane({ title: "Terminal 4" })], [row("Terminal 1", 1)]))).toEqual([{ i: 0, title: "Terminal 4", key: null, restored: null }]);
  });

  it("a hidden pane (offsetParent null) is skipped and the shown ones are numbered in order", () => {
    const d = doc([pane({ title: "Terminal 1", key: 1 }), pane({ title: "Terminal 2", key: 2, hidden: true }), pane({ title: "Terminal 3", key: 3, restored: "restored" })]);
    expect(read(d).map((p) => [p.i, p.key, p.restored])).toEqual([[0, "1", null], [1, "3", "restored"]]);
  });
});

describe("live-T-544.mjs back() reads the panes before it closes any dialog", () => {
  const src = readFileSync(new URL("./live-T-544.mjs", import.meta.url), "utf8");
  const body = /async function back\(label\) \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? "";
  const at = (s) => body.indexOf(s);

  it("the first paneStates() read comes before dismissTip() and dismissFirstRun() (an Escape from them clears the chip)", () => {
    expect(at("paneStates()")).toBeGreaterThan(-1);
    expect(at("dismissTip()")).toBeGreaterThan(at("paneStates()"));
    expect(at("dismissFirstRun(")).toBeGreaterThan(at("paneStates()"));
  });

  it("the read waits for the pane and its input field first, and a second read is logged after the dialogs", () => {
    expect(at("paneStates()")).toBeGreaterThan(at("its input field"));
    expect(body).toContain("after dialogs");
  });

  it("the prover sends the exported reader to the page as text, as it does domRows", () => {
    expect(src).toContain('import { paneStates as readPaneStates } from "./pane-states.mjs"');
    expect(src).toContain("(${readPaneStates.toString()})(document, ${JSON.stringify(TERM)})");
  });
});
