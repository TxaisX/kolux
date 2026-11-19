// PROJ-062 (T-266-b): the ports a workspace card lists on hover. The back end already answers "which
// ports does this workspace listen on" for the status bar (`ports_list`: the active workspace's own
// ports come back with `external: false`); this asks that once for the workspace the pointer is over,
// remembers the answer for a few seconds, and never asks twice at once. A failed scan keeps the last
// answer (or none): a hover must never show an error.
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useMemo, useRef, useState } from "react";

/** One listening port as the back end's `ports_list` answers it. */
export type PortRow = {
  port: number;
  addr: string;
  pid: number;
  external: boolean;
  /** When the holder started, as the system counts it, as text; the Stop that once sent it back is gone with the Ports item. */
  started: string;
  /** The Kolux terminal whose shell started the holder; null for an external port. */
  terminal: number | null;
};

/** The workspace's own ports in `rows`, each once, smallest first; ports held outside it are left out. */
export const ownPorts = (rows: readonly PortRow[]): number[] => [...new Set(rows.filter((r) => !r.external).map((r) => r.port))].sort((a, b) => a - b);

export type PortsAsk = (workspaces: string[], active: string) => Promise<PortRow[]>;

const keyOf = (path: string): string => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

export class CardPorts {
  private got = new Map<string, { at: number; ports: number[] }>();
  private busy = new Set<string>();
  constructor(
    private ask: PortsAsk,
    private changed: () => void = () => {},
    private now: () => number = Date.now,
    private ttl = 5_000,
  ) {}

  /** What the last scan found for the workspace; empty before any scan. */
  portsFor(path: string): number[] {
    return this.got.get(keyOf(path))?.ports ?? [];
  }

  /** Scans for the workspace unless a fresh answer is held or a scan is already running. */
  async load(path: string, workspaces: string[]): Promise<void> {
    const k = keyOf(path);
    const held = this.got.get(k);
    if (this.busy.has(k) || (held && this.now() - held.at < this.ttl)) return;
    this.busy.add(k);
    try {
      const ports = ownPorts(await this.ask(workspaces, path));
      const before = held?.ports ?? [];
      this.got.set(k, { at: this.now(), ports });
      if (ports.length !== before.length || ports.some((p, i) => p !== before[i])) this.changed();
    } catch {
      // keep the last answer; ponytail: a scan that keeps failing is not reported on a hover
      if (held) this.got.set(k, { ...held, at: this.now() });
    } finally {
      this.busy.delete(k);
    }
  }
}

const askBackEnd: PortsAsk = (workspaces, active) => invoke<PortRow[]>("ports_list", { workspaces, active });

/** The sidebar's hook: `portsFor(path)` for a card's facts, `load(path, all)` from its pointer-enter. */
export function useCardPorts(): { portsFor: (path: string) => number[]; load: (path: string, workspaces: string[]) => void } {
  const [, bump] = useState(0);
  const cache = useRef<CardPorts | null>(null);
  cache.current ??= new CardPorts(askBackEnd, () => bump((n) => n + 1));
  const portsFor = useCallback((path: string) => cache.current!.portsFor(path), []);
  const load = useCallback((path: string, workspaces: string[]) => void cache.current!.load(path, workspaces), []);
  return useMemo(() => ({ portsFor, load }), [portsFor, load]);
}
