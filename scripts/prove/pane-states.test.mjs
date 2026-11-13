// T-566: the pane reader live-T-544.mjs runs inside the app's page after a relaunch. No DOM library is installed, so
// the document here is a hand-rolled stub: querySelectorAll answers the two selectors the reader uses with objects that
// carry getAttribute, dataset, querySelector and offsetParent, the way real elements do.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { paneStates } from "./pane-states.mjs";

const TERM = "section.pane[data-agent]";

/** A terminal pane box: title = its aria-label minus " pane"; key = its data-key (absent when null). */
const pane = ({ title, key = null, restored = null, hidden = false }) => ({
  offsetParent: hidden ? null : {},
  dataset: key === null ? {} : { key: String(key) },
  getAttribute: (n) => (n === "aria-label" ? `${title} pane` : null),
  querySelector: (s) => (s === ".status.restored" && restored !== null ? { textContent: `  ${restored}  ` } : null),
});
const doc = (panes) => ({ querySelectorAll: (s) => (s === TERM ? panes : []) });

// The reader is sent to the page as text, (${paneStates.toString()})(document, TERM): it must not lean on anything
// from this module's scope, so every case here calls it the same way the prover does.
const read = (document) => new Function("document", "sel", `return (${paneStates.toString()})(document, sel)`)(document, TERM);

describe("paneStates (scripts/prove/pane-states.mjs)", () => {
  it("a pane with data-key reports that key with no sidebar row at all, and its restored chip's text", () => {
    expect(read(doc([pane({ title: "Terminal 7", key: 7, restored: "restored" })]))).toEqual([{ i: 0, title: "Terminal 7", key: "7", restored: "restored" }]);
  });

  it("a pane with no data-key reports key null; a chip that is not there reads null", () => {
    expect(read(doc([pane({ title: "Terminal 4" })]))).toEqual([{ i: 0, title: "Terminal 4", key: null, restored: null }]);
  });

  it("a hidden pane (offsetParent null) is skipped and the shown ones are numbered in order", () => {
    const d = doc([pane({ title: "Terminal 1", key: 1 }), pane({ title: "Terminal 2", key: 2, hidden: true }), pane({ title: "Terminal 3", key: 3, restored: "restored" })]);
    expect(read(d).map((p) => [p.i, p.key, p.restored])).toEqual([[0, "1", null], [1, "3", "restored"]]);
  });
});

describe("the reader's selectors still exist in the app", () => {
  // This is the check that was missing when `.pane-row` was removed: the reader went on querying a class no src/ file
  // declares, and the tests above stayed green because the stub answered whatever selector it was handed.
  const src = (() => {
    const walk = (dir) =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name);
        if (e.isDirectory()) return walk(p);
        return /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [readFileSync(p, "utf8")] : [];
      });
    return walk(fileURLToPath(new URL("../../src", import.meta.url))).join("\n");
  })();

  it("data-key and the restored chip are what the app really renders", () => {
    expect(src).toContain("data-key=");
    expect(src).toContain("status attention restored"); // TerminalPane.tsx: the chip the reader reads
  });

  it("the reader no longer queries the removed .pane-row class", () => {
    expect(readFileSync(new URL("./pane-states.mjs", import.meta.url), "utf8")).not.toContain("pane-row");
    expect(src).not.toContain("pane-row");
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
