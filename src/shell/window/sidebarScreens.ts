// UX lane A (shell.md row 4): the sidebar toggle in the top bar was dead on every screen but Terminals,
// Artifacts and Skills, because the project card was drawn only there. The card now follows the toggle on
// every screen except Agents, which has its own rail (agents/AgentsRail) in that place.
import type { Screen } from "../../chrome/TopBar";

/** Whether the project card (and its resize grip) is drawn on `screen` while the sidebar is open. */
export const showsProjects = (screen: Screen): boolean => screen !== "agents";

/** Screens that show the picked project themselves (Skills rescans its workspace, Space reads the active folder),
 *  so picking a project there stays put, as it did before the card showed on every screen. */
const STAYS: readonly Screen[] = ["agents", "skills", "artifacts", "space"];

/** The screen a project picked in the card leaves you on: the same screen when it shows that project, else its
 *  workspace, Terminals. */
export const screenAfterPick = (screen: Screen): Screen => (STAYS.includes(screen) ? screen : "terminals");
