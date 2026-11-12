// N-20: the Checks panel's empty state, rendered. The rules it draws from live in startPr.ts and are
// tested there; this holds the one thing only a render can say: with no answer yet, there is nothing
// to click, and the panel says it is checking rather than sitting blank.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const asked: string[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    asked.push(cmd);
    return Promise.resolve(null);
  },
}));

const { default: PrStart } = await import("./PrStart");

const html = () => renderToString(createElement(PrStart, { dir: "C:/r", onCreated: () => undefined }));

describe("VIEW-074: the empty state before any answer", () => {
  it("offers no create, one-click or composer button until the branch's state is known", () => {
    const out = html();
    expect(out).toContain('class="pr-start"');
    for (const hook of ["data-pr-open", "data-pr-one-click", "data-pr-create", "data-pr-cancel", 'role="dialog"']) expect(out).not.toContain(hook);
  });
  it("says it is checking, and says this branch has no review", () => {
    const out = html();
    expect(out).toContain("Checking whether this branch is ready…");
    expect(out).toContain("There is no review for this branch: it has no pull request.");
  });
  it("asks Rust nothing while server-rendering: no status read, no lookup", () => {
    // The effects do the reads; a panel that read during render would ask twice under StrictMode.
    html();
    expect(asked).toEqual([]);
  });
});