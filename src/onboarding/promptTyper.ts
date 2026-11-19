// ONB-017 (T-244-b): the typer the inline terminal uses to put a setup command at a shell prompt without ever
// pressing Enter, kept apart from the screen so it can be tested without one.

export const CHECK_MS = 200;
/** About fifty checks, then it stops waiting rather than polling forever (ONB-017). */
export const MAX_CHECKS = 50;
/** When no prompt text can be read at all, the terminal has been open this long. */
export const OPEN_WAIT_MS = 1500;

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[()][0-9A-B]|\u001b[=>]/g;

/** The text a terminal chunk shows: colour codes and window-title codes removed. */
export const plain = (s: string) => s.replace(ANSI, "").replace(/\r(?!\n)/g, "\n");

/** Whether the last line shown ends the way a shell prompt does (bash $ or #, zsh %, PowerShell and cmd >). */
export function promptVisible(shown: string): boolean {
  const lines = shown.split("\n").map((l) => l.replace(/\s+$/g, "")).filter(Boolean);
  const last = lines[lines.length - 1];
  return !!last && /[$#%>]$/.test(last);
}

/** A command goes in as typed text only: a line break would run it. */
export const typable = (cmd: string) => cmd.trim() !== "" && !/[\r\n\u0003\u0004\u001b]/.test(cmd);

export type Typer = {
  /** Output the terminal printed (already decoded). */
  output(text: string): void;
  /** Begin watching for a prompt. */
  start(): void;
  /** Type `cmd` at the prompt, now or as soon as one shows. Typing the same command again does nothing. */
  want(cmd: string): void;
  stop(): void;
  state(): "waiting" | "typed" | "gave-up" | "idle";
};

export type TyperDeps = {
  write: (data: string) => unknown;
  every: (fn: () => void, ms: number) => () => void;
  now: () => number;
};

/** Types `want`ed commands at the shell prompt, never pressing Enter. */
export function createTyper(d: TyperDeps): Typer {
  let shown = "";
  let sawText = false;
  let checks = 0;
  let started = 0;
  let stopWatch: (() => void) | null = null;
  let wanted: string | null = null;
  const sent = new Set<string>();
  let st: ReturnType<Typer["state"]> = "idle";

  const halt = () => {
    stopWatch?.();
    stopWatch = null;
  };
  const type = () => {
    if (wanted === null || sent.has(wanted)) return;
    sent.add(wanted);
    st = "typed";
    halt();
    void d.write(wanted);
  };
  const check = () => {
    if (wanted === null) return;
    checks++;
    if (promptVisible(shown) || (!sawText && d.now() - started >= OPEN_WAIT_MS)) return type();
    if (checks >= MAX_CHECKS) {
      st = "gave-up";
      halt();
    }
  };
  const start = () => {
    if (stopWatch) return;
    started = d.now();
    checks = 0;
    st = "waiting";
    stopWatch = d.every(check, CHECK_MS);
  };
  return {
    output(text) {
      const p = plain(text);
      if (p.trim()) sawText = true;
      shown = (shown + p).slice(-600);
    },
    start,
    want(cmd) {
      if (!typable(cmd) || sent.has(cmd)) return;
      wanted = cmd;
      if (st === "typed" || st === "gave-up") st = "idle";
      if (st === "idle") start();
    },
    stop() {
      halt();
      st = "idle";
    },
    state: () => st,
  };
}
