import { expect, test } from "vitest";
import { SCREEN_IDS } from "../../chrome/TopBar";
import { screenAfterPick, showsProjects } from "./sidebarScreens";
import sidebar from "./Sidebar.tsx?raw";

test("the project card follows the sidebar toggle on every screen except Agents (its rail takes the place)", () => {
  for (const s of SCREEN_IDS) expect(showsProjects(s), s).toBe(s !== "agents");
});

test("picking a project from any other screen lands on Terminals", () => {
  for (const s of SCREEN_IDS) expect(screenAfterPick(s), s).toBe(["agents", "skills", "artifacts", "space"].includes(s) ? s : "terminals");
});

test("Sidebar.tsx gates the card and its grip on showsProjects, not on terminals", () => {
  expect(sidebar.match(/showsProjects\(screen\) && sidebarOpen/g)).toHaveLength(2);
  expect(sidebar).not.toContain('(terminals || screen === "artifacts" || screen === "skills")');
});
