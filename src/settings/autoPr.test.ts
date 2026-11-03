import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AutoPrView, choiceOf, entriesFor, readAutoPr, withChoice } from "./autoPr";
import { enabledFor } from "../scm/autoPr";

describe("T-654 automatic pull request settings", () => {
  it("reads a missing or odd value as the GitHub default", () => {
    expect(readAutoPr({})).toEqual({ default: "github", workspaces: {} });
    expect(readAutoPr({ autoPr: { default: "x", workspaces: { "C:/a": true, "C:/b": "yes" } } })).toEqual({ default: "github", workspaces: { "C:/a": true } });
    expect(readAutoPr({ autoPr: { default: "off" } }).default).toBe("off");
  });

  it("a workspace choice round-trips through what enabledFor reads", () => {
    let v = readAutoPr({});
    v = withChoice(v, "C:\\Dev\\Work", "on");
    expect(choiceOf(v, "c:/dev/work/")).toBe("on");
    expect(enabledFor({ autoPr: v }, "c:/dev/work", "none")).toBe(true);
    v = withChoice(v, "c:/dev/work", "off");
    expect(Object.keys(v.workspaces)).toEqual(["c:/dev/work"]);
    expect(enabledFor({ autoPr: v }, "C:/Dev/Work", "github")).toBe(false);
    v = withChoice(v, "C:/DEV/WORK", "default");
    expect(v.workspaces).toEqual({});
    expect(choiceOf(v, "C:/dev/work")).toBe("default");
  });

  it("lists saved folders Kolux no longer knows, so they can be reset", () => {
    const list = entriesFor([{ path: "C:/a", name: "a" }], { default: "github", workspaces: { "c:/A": true, "D:/gone/old": false } });
    expect(list.map((e) => e.name)).toEqual(["a", "old"]);
  });

  it("shows the three defaults, the recommended one first, and a three-way select per workspace", () => {
    const html = renderToString(createElement(AutoPrView, { value: { default: "github", workspaces: { "C:/a": false } }, entries: [{ path: "C:/a", name: "alpha" }], save: () => {} }));
    expect(html).toContain("On for GitHub repositories (recommended)");
    expect(html).toContain("On for every repository");
    expect(html.indexOf("recommended")).toBeLessThan(html.indexOf("On for every repository"));
    expect(html).toContain("Use default");
    expect(html).toMatch(/aria-label="automatic pull requests for alpha"[^>]*>.*<option value="off" selected="">Off/);
  });
});
