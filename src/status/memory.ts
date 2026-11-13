// The status bar's memory figure in bytes, from the Rust side: on Windows the private bytes of Kolux
// and its web view processes (not the agents or shells), elsewhere the app's working set. Shown the
// way DESIGN.md section 8 shows it ("717.9 MB"), one decimal, GB past 1024 MB.

const MB = 1024 * 1024;

export function formatMemory(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "– MB";
  const mb = bytes / MB;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

type Visible = Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
type Every = { every: (fn: () => void, ms: number) => unknown; stop: (h: unknown) => void };
const realEvery: Every = { every: (fn, ms) => setInterval(fn, ms), stop: (h) => clearInterval(h as ReturnType<typeof setInterval>) };

/** Runs `tick` now and every `ms` while the window is visible; a hidden (minimised) window asks
 *  nothing, and the figure is read again the moment it is shown. Returns the stop. */
export function pollWhileVisible(tick: () => void, ms: number, doc: Visible = document, timers: Every = realEvery): () => void {
  let handle: unknown = null;
  const start = () => {
    if (handle !== null) return;
    tick();
    handle = timers.every(tick, ms);
  };
  const pause = () => {
    if (handle === null) return;
    timers.stop(handle);
    handle = null;
  };
  const on = () => (doc.visibilityState === "visible" ? start() : pause());
  doc.addEventListener("visibilitychange", on);
  on();
  return () => {
    doc.removeEventListener("visibilitychange", on);
    pause();
  };
}
