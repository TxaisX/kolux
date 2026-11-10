// TERM-114 / TERM-115: the small decisions behind a pane that comes back after sleep, a window
// refocus or a slow start. Pure, so they are tested without a window.

/** TERM-114: when the window regains focus, typing goes back to the pane that had it, unless the
 *  user clicked somewhere else meanwhile (then that element holds the keyboard). */
export function shouldRefocus(wasFocusedPane: boolean, active: Element | null): boolean {
  if (!wasFocusedPane) return false;
  return active === null || active.tagName === "BODY";
}

type Query = (q: string) => { addEventListener(type: "change", h: () => void): void; removeEventListener(type: "change", h: () => void): void };

/** TERM-114: fires when the display scaling changes (the window moved to a screen with another
 *  scale, or the user changed it); the media query only matches the current ratio, so it is
 *  re-armed at each new one. */
export function watchScale(onChange: () => void, ratio: () => number = () => window.devicePixelRatio, query: Query = (q) => window.matchMedia(q)): { dispose(): void } {
  let mq = query(`(resolution: ${ratio()}dppx)`);
  const handler = () => {
    mq.removeEventListener("change", handler);
    onChange();
    mq = query(`(resolution: ${ratio()}dppx)`);
    mq.addEventListener("change", handler);
  };
  mq.addEventListener("change", handler);
  return { dispose: () => mq.removeEventListener("change", handler) };
}

/** TERM-115: keystrokes typed into a terminal that is still connecting are held, in order, and
 *  sent once it connects; past `cap` bytes the rest is dropped and counted. */
export class HeldKeys {
  /** Held in order, each with whether it is the terminal's own reply (DT-C247: never typing) or typed. */
  private parts: [string, boolean][] = [];
  private size = 0;
  dropped = 0;
  constructor(private readonly cap = 16_384) {}
  /** True when the keys were held; false when they were dropped past the cap. */
  push(data: string, auto = false): boolean {
    if (this.size + data.length > this.cap) {
      this.dropped += data.length;
      return false;
    }
    this.parts.push([data, auto]);
    this.size += data.length;
    return true;
  }
  /** Sends what was held in order, neighbours of one kind joined, so a reply held before the shell started
   *  (the console's opening cursor query, TERM-098) still reaches the program as a reply, not as typing. */
  drain(write: (data: string, auto: boolean) => void): void {
    if (this.parts.length === 0) return;
    const parts = this.parts;
    this.parts = [];
    this.size = 0;
    let [run, auto] = parts[0];
    for (const [data, a] of parts.slice(1)) {
      if (a === auto) {
        run += data;
        continue;
      }
      write(run, auto);
      run = data;
      auto = a;
    }
    write(run, auto);
  }
}

/** The rows a terminal buffer exposes: enough of xterm's IBuffer for `screenLines`. */
export interface LineBuffer {
  length: number;
  getLine(y: number): { isWrapped: boolean; translateToString(trim?: boolean): string } | undefined;
}

/** TERM-116: the last `rows` buffer rows as logical lines, a soft-wrapped line joined back into one
 *  (walking back to its first row), so a secret split across rows is masked whole. */
export function screenLines(buf: LineBuffer, rows = 60): string[] {
  let start = Math.max(0, buf.length - rows);
  while (start > 0 && buf.getLine(start)?.isWrapped) start--;
  const out: string[] = [];
  for (let y = start; y < buf.length; y++) {
    const line = buf.getLine(y);
    const text = line?.translateToString(true) ?? "";
    if (line?.isWrapped && out.length > 0) out[out.length - 1] += text;
    else out.push(text);
  }
  return out;
}
