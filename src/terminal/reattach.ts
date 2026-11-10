// APP-052 (T-075): before a pane starts a terminal it asks the terminal service for the one it had.
// Every run of the service has a generation; the pane remembers the run its terminal belongs to, its
// typing carries that generation (the service refuses typing meant for a replaced run) and output
// from another run is dropped. The service may still be coming up when the window asks, so the
// question is repeated until it answers, giving up at a hard limit instead of hanging. A service
// older than the oldest protocol this window still speaks is refused; a newer one is fine
// (additions only).
export type ServiceInfo = { generation: number; protocol: number };
export type Attach = { state: "attached" | "fresh" | "replaced"; id: number | null; generation: number; protocol: number };
export type Service = { info(): Promise<ServiceInfo>; attach(paneKey: number, generation: number): Promise<Attach> };
export type Reattached =
  | { kind: "attached"; id: number; service: ServiceInfo }
  | { kind: "fresh"; service: ServiceInfo }
  | { kind: "replaced"; service: ServiceInfo }
  | { kind: "refused"; reason: string }
  | { kind: "timeout"; reason: string; waited: number };

/** The oldest service protocol this window works with. */
export const OLDEST_SERVICE = 1;
/** How long the window waits for the service to answer at all: the hard limit. */
export const LIMIT_MS = 3000;
const RETRY_MS = 100;

export type Clock = { now(): number; sleep(ms: number): Promise<void> };
const real: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

export async function reattach(service: Service, paneKey: number, known: ServiceInfo | null, limitMs = LIMIT_MS, clock: Clock = real): Promise<Reattached> {
  const started = clock.now();
  let info: ServiceInfo | null = null;
  while (info === null) {
    try {
      info = await service.info();
    } catch {
      const waited = clock.now() - started;
      if (waited >= limitMs) return { kind: "timeout", waited, reason: `the terminal service did not answer within ${Math.round(limitMs / 1000)} s` };
      await clock.sleep(Math.min(RETRY_MS, limitMs - waited));
    }
  }
  if (info.protocol < OLDEST_SERVICE) return { kind: "refused", reason: `the terminal service speaks protocol ${info.protocol}; this window needs ${OLDEST_SERVICE} or newer` };
  const had = await service.attach(paneKey, known?.generation ?? info.generation);
  if (had.state === "replaced") return { kind: "replaced", service: info };
  if (had.state === "attached" && had.id !== null) return { kind: "attached", id: had.id, service: info };
  return { kind: "fresh", service: info };
}

/** after-list #378 (ACCT-063): the terminal a reattach took back for a pane that closed while it waited; the pane kills it,
 *  as it kills a terminal it just started after closing, so nothing keeps running that no tab shows.
 *  DT-C248: a pane unmounted on its way to another cell (`handed`) leaves it to the mount that follows instead. */
export function orphanOf(back: Reattached | null, alive: boolean, handed = false): number | null {
  return !alive && !handed && back?.kind === "attached" ? back.id : null;
}

/** DT-C248 review: a terminal taken back is sized to the view it had; the new view sends its size once the
 *  id is bound (resize() cannot while it is unknown, and the observer fired during the replay). A started
 *  terminal was spawned at the view's size and needs none. */
export function needsSize(back: Reattached | null): boolean {
  return back?.kind === "attached";
}

/** Whether an output chunk comes from the run of the service this pane's terminal belongs to; a chunk without a generation, or a pane not yet bound to a run, passes. */
export function fromThisService(generation: number | undefined, service: ServiceInfo | null): boolean {
  return generation === undefined || service === null || generation === service.generation;
}
