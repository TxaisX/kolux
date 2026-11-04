// T-741 (DT-C177): one name per zoom. The top bar's Terminal zoom button draws a zoom glyph, not the "more" dots,
// and the native View menu's zoom items (the whole-interface zoom, SET-019) carry the keymap's interface names, so
// "Zoom In" means the focused terminal everywhere it appears.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import TopBar from "./TopBar";
import { actionById } from "../keys/actions";

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");

test("the Terminal zoom button draws a magnifier with a plus, not the dots", () => {
  const html = renderToString(createElement(TopBar, { screen: "terminals", classic: false, onScreen: () => {}, sidebarOpen: true, onToggleSidebar: () => {}, rightOpen: false, onToggleRight: () => {} }));
  const button = html.match(/<button[^>]*aria-label="Terminal zoom"[^>]*>([\s\S]*?)<\/button>/)?.[1] ?? "";
  expect(button).toContain('d="m10.5 10.5 3.5 3.5M5 7h4M7 5v4"');
  expect(button).not.toContain('cx="3"');
});

test("the View menu's zoom items are named as the interface zoom actions they run", () => {
  const rs = nodeFs.readFileSync(new URL("../../src-tauri/src/menu.rs", import.meta.url), "utf8");
  const label = (id: string) => rs.match(new RegExp(`item\\("${id.replace(".", "\\.")}", "([^"]+)"\\)`))?.[1];
  for (const [menu, ui] of [["zoom.in", "ui.zoomIn"], ["zoom.out", "ui.zoomOut"], ["zoom.reset", "ui.zoomReset"]]) {
    expect(label(menu)).toBe(actionById.get(ui)?.title);
    expect(label(menu)).not.toBe(actionById.get(menu)?.title); // the terminal zoom keeps the plain names
  }
});
