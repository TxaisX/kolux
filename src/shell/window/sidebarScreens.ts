// UX lane A (shell.md row 4): the sidebar toggle in the top bar was dead on every screen but Terminals,
// Artifacts and Skills, because the project card was drawn only there. The card now follows the toggle on
// every screen except Agents, which has its own rail (agents/AgentsRail) in that place.
import type { Screen } from "../../chrome/TopBar";

/** Whether the project card (and its resize grip) is drawn on `screen` while the sidebar is open. */
export const showsProjects = (screen: Screen): boolean => screen !== "agents";

/** The screen a project picked in the card leaves you on: its workspace, so Terminals, from any other screen. */
export const screenAfterPick = (screen: Screen): Screen => (screen === "agents" ? screen : "terminals");
