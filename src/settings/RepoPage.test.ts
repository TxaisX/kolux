import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { RepoView, draftSave, outsideChoice, outsideSave } from "./RepoPage";
import { projectLabel } from "../projects/model";

test("SET-033: a repository's base branch shows, and the workspaces folder is gone in one-folder mode", () => {
  const p = { id: "p1", name: "app", path: "C:/src/app" };
  const html = renderToString(createElement(RepoView, { project: p, globalDir: "C:/Users/me/kolux-rs/workspaces", onSave: () => {} }));
  expect(html).toContain("New workspaces start from");
  expect(html).toContain('placeholder="the default branch"');
  expect(html).not.toContain("Workspaces folder");
  expect(html).toContain("Kolux works in this folder");
  const own = renderToString(createElement(RepoView, { project: { ...p, base: "develop", workspacesDir: "D:/wt" }, globalDir: "C:/g", onSave: () => {} }));
  expect(own).toContain('value="develop"');
  expect(own).not.toContain('value="D:/wt"');
});

test("SET-033: a draft is saved only when it changed; viewing or leaving an untouched field writes nothing", () => {
  expect(draftSave(undefined, "")).toBeNull();
  expect(draftSave(null, "  ")).toBeNull();
  expect(draftSave("develop", "develop ")).toBeNull();
  expect(draftSave(undefined, " develop")).toBe("develop");
  expect(draftSave("develop", "")).toBe("");
});

test("SET-033: the display name shows in the page with the folder's name as its grey hint, and a blank saves as clearing it", () => {
  const p = { id: "p1", name: "app", path: "C:/src/app" };
  const html = renderToString(createElement(RepoView, { project: p, globalDir: "", onSave: () => {} }));
  expect(html).toContain("Display name");
  expect(html).toContain('placeholder="app"');
  expect(html).toContain(">app</h2>");
  const named = renderToString(createElement(RepoView, { project: { ...p, displayName: "Shop front" }, globalDir: "", onSave: () => {} }));
  expect(named).toContain('value="Shop front"');
  expect(named).toContain(">Shop front</h2>");
  expect(projectLabel({ name: "app", displayName: "  " })).toBe("app");
  expect(projectLabel({ name: "app", displayName: null })).toBe("app");
  expect(projectLabel({ name: "app", displayName: " Shop " })).toBe("Shop");
  expect(draftSave("Shop front", "")).toBe("");
});

test("SET-033: the repository can override whether workspaces made outside Kolux show, and clearing it brings the global choice back", () => {
  expect(outsideChoice({ global: false, own: null })).toBe("global");
  expect(outsideChoice({ global: false, own: true })).toBe("show");
  expect(outsideChoice({ global: true, own: false })).toBe("hide");
  expect(outsideSave("global")).toBeNull();
  expect(outsideSave("show")).toBe(true);
  expect(outsideSave("hide")).toBe(false);
  const p = { id: "p1", name: "app", path: "C:/src/app" };
  const shown = renderToString(createElement(RepoView, { project: p, globalDir: "", onSave: () => {}, outside: { global: true, own: null }, onOutside: () => {} }));
  expect(shown).toContain("Use the global choice (shown)");
  expect(shown).toContain('<option value="global" selected="">');
  const own = renderToString(createElement(RepoView, { project: p, globalDir: "", onSave: () => {}, outside: { global: true, own: false }, onOutside: () => {} }));
  expect(own).toContain('<option value="hide" selected="">');
  const none = renderToString(createElement(RepoView, { project: p, globalDir: "", onSave: () => {} }));
  expect(none).not.toContain("made outside Kolux");
});
