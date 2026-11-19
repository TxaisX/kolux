// UX lane A (shell.md row 4): the sidebar toggle in the top bar follows on every screen, the project card is drawn on
// all of them (the Agents rail that once took its place is gone).
import type { Screen } from "../../chrome/TopBar";
import { ADD_PROJECT as ADD_PROJECT_BUTTON } from "../../onboarding/actions";

/** Whether the project card (and its resize grip) is drawn on `screen` while the sidebar is open. */
export const showsProjects = (_screen: Screen): boolean => true;

/** Screens that show the picked project themselves (Space reads the active folder),
 *  so picking a project there stays put, as it did before the card showed on every screen. */
const STAYS: readonly Screen[] = ["space"];

/** The screen a project picked in the card leaves you on: the same screen when it shows that project, else its
 *  workspace, Terminals. */
export const screenAfterPick = (screen: Screen): Screen => (STAYS.includes(screen) ? screen : "terminals");

/** Job 37 A3: the one way the Start form's Add folder and first-run Pick a folder reach the sidebar's Add project
 *  (addFolderVia): is its button drawn, show the panel (sidebar open), and wait. */
export const addFolderHands = (setSidebarOpen: (on: boolean) => void, screen: Screen, setScreen: (s: Screen) => void) => ({
  panelShown: () => document.querySelector(ADD_PROJECT_BUTTON) !== null,
  showPanel: () => {
    setSidebarOpen(true);
    if (!showsProjects(screen)) setScreen("terminals");
  },
  wait: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
});
