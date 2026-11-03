import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ChangeTree, { WAIT_VIEWED } from "./ChangeTree";
import type { Entry } from "./AllChangesPane";
import type { ReadyStore } from "./sectionWindow";

const entry = (path: string, stamp: string): Entry => ({ path, staged: false, code: "M", lines: 3, binary: false, stamp });
const store = (drawn: Record<string, string>): ReadyStore => ({ get: (k: string) => drawn[k], subscribe: () => () => {}, subscribeAll: () => () => {}, version: () => 0 }) as unknown as ReadyStore;
const draw = (drawn: Record<string, string>) =>
  renderToStaticMarkup(createElement(ChangeTree, { entries: [entry("/r/a.ts", "s1")], root: "/r", width: 240, ready: store(drawn), viewed: {}, keyOf: (e: Entry) => e.path, tagOf: () => "M", onJump: () => {}, onToggleViewed: () => {} }));

describe("changed-file tree Viewed box", () => {
  it("says why the box is off while the diff has not drawn", () => {
    const html = draw({});
    expect(html).toContain("disabled");
    expect(html).toContain(WAIT_VIEWED);
  });
  it("is on, with no waiting reason, once the diff drew", () => {
    const html = draw({ "/r/a.ts": "s1" });
    expect(html).not.toContain(WAIT_VIEWED);
    expect(html).toContain("Mark this file as viewed");
  });
});
