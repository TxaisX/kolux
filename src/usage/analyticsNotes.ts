// usage-status.md:3 / 4 / 10: the lines Settings > Usage shows when something behind the analytics panel failed, so a
// failure is never a silent blank, a snapped-back switch or a spinner that just stops. Pure text, proved in usageStatusUx.test.ts.
import { NAMES, type Provider } from "./tokens";

const LOGS: Record<Provider, string> = { claude: "Claude Code", codex: "Codex" };

/** The saved token figures could not be read at all. */
export const loadFailedText = (e: unknown) => `Could not read the saved token figures (${String(e)}).`;

/** A rescan failed: the figures on screen are the last saved ones. */
export const scanFailedNote = (p: Provider, e: unknown) => `Could not rescan ${LOGS[p]}'s logs (${String(e)}); the figures shown are the last saved ones.`;

/** The Track switch did not take: it snapped back to what it was. */
export const trackFailedNote = (p: Provider, on: boolean, e: unknown) => `Could not turn ${NAMES[p]} token tracking ${on ? "on" : "off"} (${String(e)}); it is still ${on ? "off" : "on"}.`;

/** The project list could not be read, so the Kolux scope has no folders to match. */
export const scopeFailedNote = (e: unknown) => `Could not read your projects (${String(e)}), so every local use is shown instead of only Kolux workspaces.`;
