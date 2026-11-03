// 49-ux2: the keys a dialog's Ctrl+Enter shortcut is shown as, for this platform (Cmd on a Mac).
import { detectPlatform, labelParts } from "../keys/keymap";
import type { Platform } from "../keys/actions";

export const submitKeys = (platform: Platform = detectPlatform()): string[] => labelParts("Mod+Enter", platform);
