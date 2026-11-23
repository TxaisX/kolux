// The restore timeline: how long each step of bringing saved tabs back took, as one line per step in
// the diagnostics log (boot_timing.rs). The start-up line already times the window; this times what
// happens after it, which is where a window that shows at 1.6 s can still take 16 s to spawn its
// first agent. Milliseconds since the page started. Fire and forget: an older backend without the
// command rejects and nothing changes, and a mark is never a reason to slow or fail a restore.
import { invoke } from "@tauri-apps/api/core";

export function bootMark(name: string): void {
  try {
    void Promise.resolve(invoke("boot_timing", { name, ms: Math.round(performance.now()) })).catch(() => {});
  } catch {
    /* the timeline is optional */
  }
}
