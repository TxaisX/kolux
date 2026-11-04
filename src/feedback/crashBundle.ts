// APP-038 (T-324-b-rest): a crash report takes no screenshots; when it is sent, the recent diagnostic
// logs go on the clipboard instead, for the user to paste into the issue. The back end's bundle is
// already masked; it is masked again here with the feedback scrubber (idempotent) because this text
// leaves for a public page. The app still sends nothing.
import { scrub } from "./scrub";

export const CRASH_BUNDLE_COPIED = "The recent diagnostic logs (scrubbed) are on the clipboard: paste them into the issue page.";

/** What the box says in place of the screenshot picker when it holds a crash report. */
export const CRASH_BUNDLE_HINT = "Crash reports take no images; the recent diagnostic logs (scrubbed) are copied for you to paste.";

/** Reads the bundle, scrubs it and writes it; returns the note to show, never throws. */
export async function copyCrashBundle(read: () => Promise<string>, write: (text: string) => Promise<void>): Promise<string> {
  let bundle: string;
  try {
    bundle = await read();
  } catch (e) {
    return `The diagnostic logs could not be gathered (${e instanceof Error ? e.message : String(e)}); use Settings > General > Diagnostics to review them instead.`;
  }
  if (bundle.trim() === "") return "There are no diagnostic logs to copy.";
  try {
    await write(scrub(bundle));
  } catch {
    return "The diagnostic logs could not be put on the clipboard; use Settings > General > Diagnostics to review them instead.";
  }
  return CRASH_BUNDLE_COPIED;
}
