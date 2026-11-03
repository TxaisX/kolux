// T-702 (DT-C138): the right sidebar's other tabs. Checks' Refresh and Tokens' "Turn it on" link are driven
// through their real handlers, and the content search's small targets are held to 24px.
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeNode, byLabel, byText, click, find, installDom, mount, until, type FakeDocument } from "../tasks/fakeDom";

const calls: string[] = [];
let gate: Promise<void> | null = null; // while set, scm_pr_checks waits for it (to see the refresh in progress)
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    calls.push(cmd);
    if (cmd === "scm_pr_checks") {
      if (gate) await gate;
      throw new Error("boom"); // an answer with no pull request draws no child panels
    }
    if (cmd === "get_settings") return {};
    return null;
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

let doc: FakeDocument;
beforeEach(() => {
  calls.length = 0;
  gate = null;
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout });
  (globalThis as unknown as Record<string, unknown>).localStorage = dom.win.localStorage;
});

const spinning = (b: FakeNode) => find(b, (n) => (n.attrs.class ?? "").includes("spin")).length > 0;

describe("T-702 Checks tab", () => {
  it("Refresh the checks asks again, busy and spinning until the answer is back", async () => {
    const { default: ChecksPanel } = await import("./ChecksPanel");
    const { container } = await mount(createElement(ChecksPanel, { dir: "/r", linked: null, visible: true }), doc);
    await until(() => container.textContent.includes("could not be read"), "the first answer");
    const before = calls.filter((c) => c === "scm_pr_checks").length;
    let open!: () => void;
    gate = new Promise((r) => (open = r));
    await click(container, byLabel(container, "button", "Refresh the checks")[0]);
    const b = byLabel(container, "button", "Refresh the checks")[0];
    expect(calls.filter((c) => c === "scm_pr_checks").length).toBe(before + 1);
    expect(b.attrs["aria-busy"]).toBe("true");
    expect(spinning(b)).toBe(true);
    open();
    await until(() => byLabel(container, "button", "Refresh the checks")[0].attrs["aria-busy"] === "false", "the refresh to end");
    expect(spinning(byLabel(container, "button", "Refresh the checks")[0])).toBe(false);
  });
});

describe("T-702 Tokens tab", () => {
  it('"Turn it on in Settings → Usage" runs its open handler', async () => {
    const { TrackingOff } = await import("../insights/InsightsPanel");
    const onOpen = vi.fn();
    const { container } = await mount(createElement(TrackingOff, { onOpen }), doc);
    await click(container, byText(container, "button", "Turn it on in Settings → Usage")[0]);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("T-702 24px targets", () => {
  const fs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
  const css = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
  it("the content search's boxes, toggles and result rows, and the Tokens link, are at least 24px", () => {
    const extras = css("../editor/editor-extras.css");
    expect(extras).toContain(".content-search input, .cs-file > button { min-height: 24px; }");
    expect(extras).toContain(".content-search .cs-row .ib { min-width: 24px; }");
    expect(css("../insights/insights.css")).toMatch(/\.ins-link \{ min-height: 24px;/);
  });
});
