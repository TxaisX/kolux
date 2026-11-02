// VIEW-078: the pure parts of the status bar's Ports item. The back end (ports.rs) lists the
// listening ports and says which belong to the active workspace; this file picks up the address a
// dev server printed in its terminal, checks it against the listening ports (and binds it to the
// terminal that printed it), decides where Open goes, what a Stop sends back and what a failed scan
// leaves on screen.

export type PortRow = {
  port: number;
  addr: string;
  pid: number;
  external: boolean;
  /** When the holder started, as the system counts it, as text (it does not fit a number); a Stop sends it back so a reused pid is refused. */
  started: string;
  /** The Kolux terminal whose shell started the holder; null for an external port. */
  terminal: number | null;
};

// Colours and cursor moves in terminal output are not part of an address.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|[A-Za-z0-9.-]+):(\d{2,5})(?:\/[^\s'"<>)\]]*)?/g;

/** Every web address with a port in a piece of terminal output, as [port, address]. */
export function urlsIn(text: string): [number, string][] {
  const clean = text.replace(ANSI, "");
  const out: [number, string][] = [];
  for (const m of clean.matchAll(URL_RE)) {
    const port = Number(m[1]);
    if (port > 0 && port <= 65535) out.push([port, m[0]]);
  }
  return out;
}

/** The addresses terminals printed, newest per terminal and port, capped so a noisy log cannot grow it. */
export class PrintedUrls {
  private seen = new Map<string, string>();
  /** Notes the addresses in `text` printed by `terminal`; a port printed again there keeps its newest address. */
  record(text: string, terminal: number): void {
    for (const [port, url] of urlsIn(text)) {
      const k = `${terminal}:${port}`;
      this.seen.delete(k);
      this.seen.set(k, url);
    }
    while (this.seen.size > 200) this.seen.delete(this.seen.keys().next().value as string);
  }
  /** The address printed for `port` by the terminal whose shell started a program listening there. An address
   * printed for a port nothing holds is stale, and one printed in terminal A never labels terminal B's server. */
  forPort(port: number, listening: readonly PortRow[]): string | null {
    for (const r of listening) {
      if (r.port !== port || r.terminal === null) continue;
      const url = this.seen.get(`${r.terminal}:${port}`);
      if (url) return url;
    }
    return null;
  }
}

/** What a Stop sends the back end: the row as the user saw it, start time included, so a pid that
 * now names another program is refused there. */
export const stopArgs = (workspaces: string[], active: string, r: PortRow) => ({ workspaces, active, port: r.port, pid: r.pid, started: r.started });

/** What a Stop did, as the back end reports it: the program was ended; it had already ended (success, nothing
 * ended); it still runs but no longer holds the port (nothing ended). A refusal comes back as an error instead. */
export type StopOutcome = "stopped" | "gone" | "moved";

/** The note under the title after a Stop: only a program that was ended reads as stopped. */
export const stopNote = (port: number, outcome: StopOutcome): string =>
  outcome === "stopped" ? `Stopped port ${port}` : outcome === "gone" ? `Port ${port} was already gone; nothing was stopped` : `Port ${port} is no longer held by that program; nothing was stopped`;

/** The address Open uses: what the dev server printed when known, otherwise plain http on the listening address. */
export function openAddress(row: PortRow, printed: string | null): string {
  if (printed) return printed;
  const any = row.addr === "0.0.0.0" || row.addr === "::" || row.addr === "";
  const host = any ? "localhost" : row.addr.includes(":") ? `[${row.addr}]` : row.addr;
  return `http://${host}:${row.port}`;
}

/** Open goes to the Kolux browser; Shift with Ctrl (or Cmd) goes to the system browser instead. */
export const openWhere = (e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): "kolux" | "system" => (e.shiftKey && (e.ctrlKey || e.metaKey) ? "system" : "kolux");

/** What the popover shows after a scan: a failure names its problem and keeps the last good list. */
export type PortsView = { rows: PortRow[]; error: string | null };
export const afterScan = (prev: PortsView, got: { rows: PortRow[] } | { error: string }): PortsView => ("error" in got ? { rows: prev.rows, error: got.error } : { rows: got.rows, error: null });

/** The count the status bar item shows: only the workspace's own ports. */
export const ownCount = (rows: readonly PortRow[]): number => rows.filter((r) => !r.external).length;

/** Terminal output arrives base64 encoded; the text, or empty when it is not text. */
export function decodeOutput(data: string): string {
  try {
    const bin = atob(data);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}
