// NATIVE-TERMINAL.md: the Terminal page's drawing-engine switch (bug 20261112-1130). Windows only, off by
// default, and it saves the field the panes read.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import NativeTerminalCard from "./NativeTerminalCard";
import { searchSettings } from "./search";

const html = (settings: Record<string, unknown>, platform: "win32" | "linux" | "darwin", saved: Array<Record<string, unknown>> = []) =>
  renderToString(createElement(NativeTerminalCard, { settings, platform, onSave: (patch: Record<string, unknown>) => saved.push(patch) }));

const checked = (h: string, label: string) => new RegExp(`role="switch"(?:[^>]*checked)[^>]*/>\\s*${label}`).test(h);

test("NATIVE-TERMINAL: the switch is on the Terminal page for Windows only", () => {
  const h = html({}, "win32");
  expect(h).toContain("Draw panes with the Windows Terminal engine (experimental)");
  expect(h).toContain("Microsoft.Terminal.Control.dll");
  expect(html({}, "linux")).not.toContain("Windows Terminal engine");
  expect(html({}, "darwin")).not.toContain("Windows Terminal engine");
});

test("kept-warm shell: off by default, on every platform, its cost in the label, and it saves the field the panes read", () => {
  const label = "Keep a shell ready per folder: new terminals open in about 0.3 s, uses about 56 MB per open folder";
  for (const p of ["win32", "linux", "darwin"] as const) {
    expect(html({}, p)).toContain(label);
    expect(checked(html({}, p), "Keep a shell ready")).toBe(false);
  }
  expect(checked(html({ terminalWarmShell: true }, "win32"), "Keep a shell ready")).toBe(true);
  expect(checked(html({ terminalWarmShell: "true" }, "win32"), "Keep a shell ready")).toBe(false);
});

test("NATIVE-TERMINAL: it starts off and shows the saved value", () => {
  expect(checked(html({}, "win32"), "Draw panes")).toBe(false);
  expect(checked(html({ terminalNative: true }, "win32"), "Draw panes")).toBe(true);
});

test("NATIVE-TERMINAL: a search for the engine finds the card", () => {
  const hit = searchSettings("native terminal engine")?.pages.some((h) => h.page === "terminal" && (h.sections === "all" || h.sections.includes("native")));
  expect(hit).toBe(true);
});
