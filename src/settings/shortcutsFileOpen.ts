// after-list 499 (SET-039): the shortcuts file opens in any app of Settings > General > Open in, not
// only the system's default; keybindings_show checks the command against that list.
import { invoke } from "@tauri-apps/api/core";
import { commandOf, fileTargetsOf, type App } from "../open/openIn";

/** The apps the shortcuts file can open in: the saved Open in list without the file manager (Show in folder covers that). */
export const shortcutsFileApps = (settings: Record<string, unknown> | null | undefined): App[] => fileTargetsOf(settings);

export const openShortcutsFileIn = (app: App): Promise<void> => invoke<void>("keybindings_show", { reveal: false, command: commandOf(app) });
