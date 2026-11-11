// Speed (PKG-4): at a window's start several mounts ask for the settings within the same few milliseconds, and
// `get_settings` runs on the window's thread and serialises the whole object each time. Callers that ask while
// one read is in flight share its promise. There is no cache: once the read settles, the next call is a real
// read again, so a read after a save always sees what the save wrote.
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

type Settings = Record<string, unknown>;

/** A reader of `get_settings` over `invoke`, sharing the read that is in flight. Injectable for tests. */
export function sharedReader(invoke: (cmd: string) => Promise<Settings>): () => Promise<Settings> {
  let inFlight: Promise<Settings> | null = null;
  return () => {
    if (inFlight) return inFlight;
    const read = invoke("get_settings");
    const mine = read.finally(() => {
      if (inFlight === mine) inFlight = null;
    });
    inFlight = mine;
    return mine;
  };
}

/** The window's settings read: a start's mount reads share one `get_settings`. Not for a read that follows a
 *  write (the save path reads for real). */
export const sharedRead = sharedReader((cmd) => tauriInvoke<Settings>(cmd));
