// N-03 (audit): every visible editor tab asked Rust for its own disk stamp every POLL_MS, so a split
// view of N tabs sent N `file_stamps` calls per tick — and each of those runs `fence.allow`, which
// lists the worktrees under the fence mutex. The worktrees are the same for every tab, so the listing
// was done N times a tick. One poller now asks once for every visible path and hands each tab its own
// answer; a tab that comes forward, or the window gaining focus, still checks at once.
import { invoke } from "@tauri-apps/api/core";
import { POLL_MS, type Stamp } from "./diskChange";

/** What one round asks for: every watched path once, in the order first watched. */
export function roundPaths(watched: Iterable<string>): string[] {
  return [...new Set(watched)];
}

/** The stamps an answer holds for `paths`, in that order. A short or failed answer leaves the rest
 *  unseen (null), the same answer a tab reading on its own gets for a file it cannot look at. */
export function answersFor(paths: string[], got: (Stamp | null)[] | null): (Stamp | null)[] {
  return paths.map((_, i) => got?.[i] ?? null);
}

type Sink = (stamp: Stamp | null) => void;

const sinks = new Map<string, Set<Sink>>();
let timer: number | undefined;
let soon: number | undefined;
let asking = false;

async function round(): Promise<void> {
  const paths = roundPaths(sinks.keys());
  if (!paths.length || asking) return;
  asking = true;
  let got: (Stamp | null)[] | null = null;
  try {
    got = await invoke<(Stamp | null)[]>("file_stamps", { paths });
  } catch {
    got = null;
  } finally {
    asking = false;
  }
  const answers = answersFor(paths, got);
  paths.forEach((path, i) => {
    const set = sinks.get(path);
    if (set) for (const sink of [...set]) sink(answers[i]);
  });
}

const onFocus = () => void round();

function start(): void {
  if (timer !== undefined) return;
  timer = window.setInterval(() => void round(), POLL_MS);
  window.addEventListener("focus", onFocus);
}

function stop(): void {
  if (timer === undefined) return;
  window.clearInterval(timer);
  window.removeEventListener("focus", onFocus);
  timer = undefined;
}

/** Watch one file's disk stamp while its tab is in front: `sink` is called with a stamp on every round
 *  (the first one almost at once). The returned function stops watching. */
export function watchStamp(path: string, sink: Sink): () => void {
  let set = sinks.get(path);
  if (!set) sinks.set(path, (set = new Set()));
  set.add(sink);
  start();
  // A tab that just came forward is checked at once, as before; the other visible tabs join that one round.
  if (soon === undefined) {
    soon = window.setTimeout(() => {
      soon = undefined;
      void round();
    }, 0);
  }
  return () => {
    const own = sinks.get(path);
    own?.delete(sink);
    if (own && !own.size) sinks.delete(path);
    if (!sinks.size) stop();
  };
}

/** For tests and the app's teardown: forget every watcher (the interval goes with the last one). */
export function stopAllStamps(): void {
  sinks.clear();
  stop();
  if (soon !== undefined) window.clearTimeout(soon);
  soon = undefined;
}