// The Settings button reads the settings page's code as soon as the pointer or the keyboard reaches it, so the
// click finds it there (DT-C230 as amended: a hover or a focus on the control that opens a surface loads it).
import { expect, test } from "vitest";
import { SettingsPage } from "../lazy/pages";
import src from "./ProjectsPanel.tsx?raw";

test("the sidebar's Settings button warms the settings page on hover and on focus", () => {
  const button = /<button[^>]*data-sidebar-settings[^>]*>/.exec(src)?.[0] ?? "";
  expect(button).toContain("onPointerEnter={SettingsPage.warm}");
  expect(button).toContain("onFocus={SettingsPage.warm}");
  expect(typeof SettingsPage.warm).toBe("function");
});
