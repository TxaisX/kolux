// SET-039 (T-323): the Open in list: presets, custom drafts, order, and old preset rows.
import { describe, expect, it } from "vitest";
import { addApp, addCustom, DEFAULT_APPS, draftReady, moveApp, OPEN_IN_FIELD, PRESETS, presetsLeft, readOpenIn, removeApp } from "./openIn";
import { fileApps } from "../scm/openWith";

const zed = PRESETS.find((p) => p.id === "zed")!;

describe("SET-039 Open in apps", () => {
  it("a preset added shows in every Open in menu, and removing it takes it out", () => {
    const list = addApp(DEFAULT_APPS, zed);
    expect(fileApps({ [OPEN_IN_FIELD]: list }).map((i) => i.label)).toContain("Open in Zed");
    expect(fileApps({ [OPEN_IN_FIELD]: removeApp(list, "zed") }).map((i) => i.label)).not.toContain("Open in Zed");
    expect(presetsLeft(list).some((p) => p.id === "zed")).toBe(false);
  });

  it("a custom entry is saved only with both a name and a command", () => {
    expect(draftReady({ name: "Vim", command: " " })).toBe(false);
    expect(addCustom([], { name: "Vim", command: "" })).toEqual([]);
    expect(addCustom([], { name: " Vim ", command: "gvim  --remote" })).toEqual([{ id: "custom:gvim --remote", name: "Vim", command: "gvim  --remote" }]);
  });

  it("rows saved by older versions are recognised by their command; bad rows drop out", () => {
    const s = { [OPEN_IN_FIELD]: [{ name: "VS Code (old)", command: "  CODE " }, { name: "", command: "x" }, null, { id: "vscode", command: "code" }] };
    expect(readOpenIn(s)).toEqual([PRESETS.find((p) => p.id === "vscode")]);
    expect(readOpenIn({})).toEqual(DEFAULT_APPS);
    expect(readOpenIn({ [OPEN_IN_FIELD]: [] })).toEqual([]);
  });

  it("rows reorder within the list", () => {
    const l = DEFAULT_APPS;
    expect(moveApp(l, "vscode", -1).map((a) => a.id)).toEqual(["vscode", "explorer"]);
    expect(moveApp(l, "explorer", -1)).toBe(l);
  });
});
