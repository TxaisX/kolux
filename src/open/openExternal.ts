// Goal 0 (Txais, 2026-11-12): Kolux no longer draws web pages of its own, so an address the app or
// an agent shows opens in the user's own browser (Chrome or whatever Windows opens). One wrapper
// around the back end's open_external (src-tauri/src/artifacts.rs), which admits web and mail links
// only, so every "open" in the app takes the same road and the same checks.
import { invoke } from "@tauri-apps/api/core";

/** Opens `url` in the system browser. Rejects with the back end's own words when it refuses the address. */
export const openExternal = (url: string): Promise<void> => invoke("open_external", { url });
