// The Terminal page's kept-warm shell switch: on every platform, off by default, and it saves the field the panes read.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import WarmShellCard from "./WarmShellCard";

const html = (settings: Record<string, unknown>, platform: "win32" | "linux" | "darwin", saved: Array<Record<string, unknown>> = []) =>
  renderToString(createElement(WarmShellCard, { settings, platform, onSave: (patch: Record<string, unknown>) => saved.push(patch) }));

const checked = (h: string, label: string) => new RegExp(`role="switch"(?:[^>]*checked)[^>]*/>\\s*${label}`).test(h);

test("kept-warm shell: off by default, on every platform, its cost in the label, and it saves the field the panes read", () => {
  const label = "Keep a shell ready per folder: new terminals open in about 0.3 s, uses about 56 MB per open folder";
  for (const p of ["win32", "linux", "darwin"] as const) {
    expect(html({}, p)).toContain(label);
    expect(checked(html({}, p), "Keep a shell ready")).toBe(false);
  }
  expect(checked(html({ terminalWarmShell: true }, "win32"), "Keep a shell ready")).toBe(true);
  expect(checked(html({ terminalWarmShell: "true" }, "win32"), "Keep a shell ready")).toBe(false);
});

test("the Windows Terminal engine switch is gone: one drawing engine, xterm", () => {
  expect(html({ terminalNative: true }, "win32")).not.toContain("Windows Terminal engine");
});
