import { expect, test, vi } from "vitest";
import panel from "./ProjectsPanel.tsx?raw";
import { onWorkspaceStatus, WORKSPACE_STATUS } from "./statusRefresh";

const status = () => new CustomEvent(WORKSPACE_STATUS, { detail: { paths: ["C:\w\a"], status: "done" } });

test("a workspace status event refreshes the sidebar right away, and not after unmount", () => {
  const bus = new EventTarget();
  const refresh = vi.fn();
  const off = onWorkspaceStatus(bus, refresh);
  bus.dispatchEvent(status());
  expect(refresh).toHaveBeenCalledTimes(1);
  bus.dispatchEvent(new CustomEvent("kolux:something-else"));
  expect(refresh).toHaveBeenCalledTimes(1);
  off();
  bus.dispatchEvent(status());
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("the sidebar refreshes the worktrees when the workspace status event arrives", () => {
  expect(panel).toMatch(/onWorkspaceStatus\(window, \(\) => void refreshWorktrees\(projects\)/);
});
