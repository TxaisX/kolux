import { expect, test } from "vitest";
import { SCREEN_IDS } from "../../chrome/TopBar";
import { screenAfterPick, showsProjects } from "./sidebarScreens";
import sidebar from "./Sidebar.tsx?raw";

test("the project card follows the sidebar toggle on every screen", () => {
  for (const s of SCREEN_IDS) expect(showsProjects(s), s).toBe(true);
});

test("picking a project from any other screen lands on Terminals", () => {
  for (const s of SCREEN_IDS) expect(screenAfterPick(s), s).toBe(["space"].includes(s) ? s : "terminals");
});

test("Sidebar.tsx gates the card and its grip on showsProjects, not on terminals", () => {
  expect(sidebar.match(/showsProjects\(screen\) && sidebarOpen/g)).toHaveLength(2);
  expect(sidebar).not.toContain('(terminals || screen === "space")');
});

test("job 37 A3: Pick a folder and the Start form's Add folder use the same hands to reach Add project", async () => {
  const { addFolderHands } = await import("./sidebarScreens");
  const hosts = (await import("./Hosts.tsx?raw")).default;
  const seats = (await import("./SeatChooser.tsx?raw")).default;
  for (const src of [hosts, seats]) {
    expect(src).toContain("addFolderHands(setSidebarOpen, screen, setScreen)");
    expect(src).not.toContain("document.querySelector(ADD_PROJECT_BUTTON)");
  }
  const did: string[] = [];
  const h = addFolderHands((on) => void did.push(`sidebar ${on}`), "terminals", (s) => void did.push(`screen ${s}`));
  h.showPanel();
  expect(did).toEqual(["sidebar true"]);
  await expect(h.wait(0)).resolves.toBeUndefined();
});
