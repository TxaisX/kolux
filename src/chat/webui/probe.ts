// Is there anything said in this past chat? (round 3 P2, lag). OpenCode's list carries no message count, so a row still
// called "New chat" is read to find out (history.ts `visibleSessions`). Every chat pane has its own history column, so
// the answers are kept here, once for the whole window, and not per pane:
//   - one answer per `cwd|id|updatedAt`, kept: a chat that gains a message has a new `updatedAt`, so it is asked again;
//   - one read in flight per key, so two panes asking about the same chat share it;
//   - at most MAX_PROBES reads at a time across all panes, so a long list never queues a wall of reads at the engine;
//   - one message is read (`limit` 1), enough to know the chat is not empty;
//   - a read that failed is not kept as "empty": it is left for the next `updatedAt`, or tried again after a minute.
import { CHAT_AGENT } from "../opencode";
import { chatHistory } from "../live/client";

export const MAX_PROBES = 3;
export const RETRY_AFTER_MS = 60_000;
/** Answers kept before the oldest are forgotten, so a long session does not grow the table without end. */
const KEEP = 1000;

const known = new Map<string, boolean>();
const failedAt = new Map<string, number>();
const flying = new Map<string, Promise<boolean | null>>();
const waiting: Array<() => void> = [];
let running = 0;

const keyOf = (cwd: string, id: string, updatedAt: number) => `${cwd}|${id}|${updatedAt}`;

/** The kept answer for a chat: `true` it has words, `false` it is empty, `undefined` not asked yet. */
export function probed(cwd: string, id: string, updatedAt: number): boolean | undefined {
  return known.get(keyOf(cwd, id, updatedAt));
}

function takeSlot(): Promise<void> {
  if (running < MAX_PROBES) {
    running++;
    return Promise.resolve();
  }
  return new Promise((go) => waiting.push(() => (running++, go())));
}
function freeSlot() {
  running--;
  waiting.shift()?.();
}

async function read(key: string, cwd: string, id: string, now: number): Promise<boolean | null> {
  await takeSlot();
  try {
    const r = await chatHistory(CHAT_AGENT, cwd, id, 1);
    const has = Array.isArray(r?.items) && r.items.length > 0;
    known.set(key, has);
    failedAt.delete(key);
    if (known.size > KEEP) known.delete(known.keys().next().value as string);
    return has;
  } catch {
    failedAt.set(key, now);
    return null;
  } finally {
    flying.delete(key);
    freeSlot();
  }
}

/** Whether the chat has words in it: `true`/`false`, or `null` when it could not be read (then it is not kept, and
 *  not asked again for a minute unless the chat changed). */
export function probeChat(cwd: string, id: string, updatedAt: number, now = Date.now()): Promise<boolean | null> {
  const key = keyOf(cwd, id, updatedAt);
  const kept = known.get(key);
  if (kept !== undefined) return Promise.resolve(kept);
  const going = flying.get(key);
  if (going) return going;
  const bad = failedAt.get(key);
  if (bad !== undefined && now - bad < RETRY_AFTER_MS) return Promise.resolve(null);
  const p = read(key, cwd, id, now);
  flying.set(key, p);
  return p;
}

/** For tests: forget everything. */
export function resetProbes(): void {
  known.clear();
  failedAt.clear();
  flying.clear();
  waiting.length = 0;
  running = 0;
}
