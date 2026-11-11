// Opening a file in an editor tab asks the back end three things: the file's stamp (EDIT-003), its text and the draft
// kept for it (EDIT-004). They used to go one after another, each waiting on the last answer; now all three are sent
// at once, the stamp first. The back end answers these commands in the order they arrive, so the stamp is still taken
// before the text is read (T-073: a write landing in between shows at the next check), and the tab waits one round
// trip instead of three.
import type { Stamp } from "./diskChange";
import type { Draft } from "./drafts";

export type OpenIo = {
  stamp: () => Promise<Stamp | null>;
  read: () => Promise<string>;
  /** The draft lookup, or null when the tab keeps none (read-only). */
  draft: (() => Promise<Draft | null>) | null;
};

/** The stamp and the text together, and the draft lookup already on its way (a failed lookup reads as none). */
export function readForOpen(io: OpenIo): { read: Promise<{ stamp: Stamp | null; text: string }>; draft: Promise<Draft | null> } {
  const stamp = io.stamp();
  const text = io.read();
  const draft = io.draft ? io.draft().catch(() => null) : Promise.resolve(null);
  return { read: Promise.all([stamp, text]).then(([s, t]) => ({ stamp: s, text: t })), draft };
}
