// Shell integration marks in a pane's output (ACCT-047, TERM-058).
//
// The shells Kolux starts are wrapped (src-tauri shell_marks.rs) so they print FinalTerm-style
// marks: OSC 133;A before each prompt, OSC 133;C when a command starts, OSC 133;D;<exit> when it
// ends. Programs set titles with OSC 0 / OSC 2. This module finds those sequences in the raw PTY
// bytes BEFORE they reach xterm, even when a sequence arrives split across output chunks, so the
// pane can hold the shell's output back until the first prompt (ACCT-047), type the startup
// command exactly once when the shell is ready, and follow the running program's identity
// (TERM-058). Replayed or restored output is never fed to the scanner: it never counts as a
// command starting or finishing.

import type { Agent } from "../chrome/VendorMark";
import { titleOwner } from "../status/titleOwner";

export type Mark = { kind: "prompt" } | { kind: "start" } | { kind: "end"; code: number | null } | { kind: "title"; text: string };

const ESC = 0x1b;
const BEL = 0x07;
/** Longest OSC body kept; a longer one is a program printing garbage, not a mark. */
const OSC_CAP = 4096;

/** Finds marks in a byte stream; keeps a sequence that straddles two chunks. */
export class Scanner {
  private state: "ground" | "esc" | "osc" | "oscEsc" = "ground";
  private osc: number[] = [];
  private readonly decoder = new TextDecoder();

  feed(bytes: Uint8Array): Mark[] {
    const out: Mark[] = [];
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      switch (this.state) {
        case "ground":
          if (b === ESC) this.state = "esc";
          break;
        case "esc":
          if (b === 0x5d) {
            this.state = "osc";
            this.osc = [];
          } else this.state = b === ESC ? "esc" : "ground";
          break;
        case "osc":
          if (b === BEL) this.finish(out);
          else if (b === ESC) this.state = "oscEsc";
          else if (this.osc.length >= OSC_CAP) {
            this.osc = [];
            this.state = "ground";
          } else this.osc.push(b);
          break;
        case "oscEsc":
          if (b === 0x5c) this.finish(out);
          else {
            // Another escape began inside the OSC: the OSC is abandoned, the new one is read.
            this.osc = [];
            this.state = b === 0x5d ? "osc" : b === ESC ? "esc" : "ground";
          }
          break;
      }
    }
    return out;
  }

  private finish(out: Mark[]) {
    const body = this.decoder.decode(new Uint8Array(this.osc));
    this.osc = [];
    this.state = "ground";
    const mark = parseOsc(body);
    if (mark) out.push(mark);
  }
}

/** The mark an OSC body stands for, or null for a sequence Kolux does not read. */
export function parseOsc(body: string): Mark | null {
  const semi = body.indexOf(";");
  const code = semi < 0 ? body : body.slice(0, semi);
  const rest = semi < 0 ? "" : body.slice(semi + 1);
  if (code === "133") {
    const [letter, exit] = rest.split(";");
    if (letter === "A") return { kind: "prompt" };
    if (letter === "C") return { kind: "start" };
    if (letter === "D") {
      const n = exit === undefined || exit === "" ? NaN : Number(exit);
      return { kind: "end", code: Number.isInteger(n) ? n : null };
    }
    return null;
  }
  if (code === "0" || code === "2") return { kind: "title", text: rest.trim() };
  return null;
}

/** ACCT-047: output before the first prompt is held and shown when the shell signals ready, or
 *  when it exits (or gives up waiting) without doing so. Nothing is held once the gate is open. */
export class Gate {
  private held: Uint8Array[] = [];
  private heldBytes = 0;
  private isOpen: boolean;
  /** Held bytes dropped at the cap (oldest first); the newest output is what matters when a shell dies. */
  dropped = 0;

  constructor(wait: boolean, private readonly cap = 1 << 20) {
    this.isOpen = !wait;
  }

  get open(): boolean {
    return this.isOpen;
  }

  /** The bytes to show now: the chunk itself once open, the held output plus the chunk when
   *  `ready` just arrived, nothing while still waiting. */
  push(chunk: Uint8Array, ready: boolean): Uint8Array | null {
    if (this.isOpen) return chunk;
    if (ready) {
      const held = this.release();
      if (!held) return chunk;
      const out = new Uint8Array(held.length + chunk.length);
      out.set(held, 0);
      out.set(chunk, held.length);
      return out;
    }
    this.held.push(chunk);
    this.heldBytes += chunk.length;
    while (this.heldBytes > this.cap && this.held.length > 1) {
      const gone = this.held.shift()!;
      this.heldBytes -= gone.length;
      this.dropped += gone.length;
    }
    return null;
  }

  /** Opens the gate (shell exited or waited long enough) and hands back whatever was held. */
  release(): Uint8Array | null {
    this.isOpen = true;
    if (this.held.length === 0) return null;
    const out = new Uint8Array(this.heldBytes);
    let at = 0;
    for (const h of this.held) {
      out.set(h, at);
      at += h.length;
    }
    this.held = [];
    this.heldBytes = 0;
    return out;
  }
}

/** Mirrors shell_marks::ShellKind::of: the shells Kolux wraps, so the pane knows whether to wait
 *  for a prompt mark. Unknown (null: an automatic pick) counts as wrapped, since the automatic
 *  order starts with PowerShell on Windows and the login shell elsewhere; the gate's wait and the
 *  real started program (ACCT-046) correct a wrong guess. */
export function printsMarks(shell: string | null | undefined): boolean {
  if (shell === null || shell === undefined || shell.trim() === "") return true;
  const stem = shell.trim().replace(/^"|"$/g, "").split(/[\\/]/).pop()!.replace(/\.exe$/i, "").toLowerCase();
  return ["zsh", "bash", "fish", "pwsh", "powershell"].includes(stem);
}

/** How long a wrapped shell may stay silent about its prompt before its output is shown anyway. */
export const READY_WAIT_MS = 4000;

/** Mirrors shell_marks::typed_as_is: short, plain lines may be typed; anything else goes whole. */
export function typedAsIs(command: string): boolean {
  return command.length <= 160 && !/["'\\\n\r`]/.test(command);
}

/** The bytes that run `command` in a ready shell: typed with Enter, or handed over as one
 *  bracketed paste (the line editor takes it as a unit, quotes and all) followed by Enter. */
export function startupText(command: string): string {
  const c = command.replace(/\r?\n$/, "");
  return typedAsIs(c) ? `${c}\r` : `\x1b[200~${c}\x1b[201~\r`;
}

/** ACCT-047: the startup command goes in once, at the first prompt mark. A shell without
 *  hooks (`wrapped` false) falls back to the SESS-051 quiet timer. Later prompts never resend. */
export class Startup {
  private sent = false;
  private readonly command: string | null;

  constructor(command: string | null | undefined, private readonly wrapped: boolean) {
    const c = command?.trim();
    this.command = c ? c : null;
  }

  /** A command still waiting to be delivered. */
  get pending(): boolean {
    return this.command !== null && !this.sent;
  }

  /** The bytes to write at a prompt mark; null when there is nothing (or it already went). */
  onPrompt(): string | null {
    if (!this.pending) return null;
    this.sent = true;
    return startupText(this.command!);
  }

  /** The bytes to write when the program went quiet; only for shells that print no marks. */
  onQuiet(): string | null {
    if (this.wrapped) return null;
    return this.onPrompt();
  }

  /** The shell ended: true when the command never went (a launch that failed, VIEW-069). */
  exited(): boolean {
    const lost = this.pending;
    this.sent = true;
    return lost;
  }
}

/** TERM-058: the agent a window title names, when it does: only by the marks the agent itself prints (STAT-033, titleOwner), never a name inside the task text; marks that conflict name nobody. */
export function agentFromTitle(title: string): Exclude<Agent, "shell"> | null {
  const { owners, unknown } = titleOwner(title);
  if (unknown || owners.length !== 1) return null;
  return owners[0] === "claude" || owners[0] === "codex" ? owners[0] : null;
}

/** What a plain shell pane knows about the program it runs, from the marks alone. */
export type Identity = {
  /** A command is running (between the start mark and the next prompt or end mark). */
  running: boolean;
  /** The title the running program set; null at the prompt. */
  title: string | null;
  /** The agent recognised from the title while a command runs. */
  agent: Exclude<Agent, "shell"> | null;
};

export const IDLE: Identity = { running: false, title: null, agent: null };

/** TERM-058: an agent started by hand is recognised from its title while the command runs and
 *  forgotten when the prompt returns. `restored` output never changes anything. */
export function reduceIdentity(state: Identity, mark: Mark, restored = false): Identity {
  if (restored) return state;
  switch (mark.kind) {
    case "start":
      return state.running ? state : { ...state, running: true };
    case "prompt":
    case "end":
      return IDLE;
    case "title": {
      const agent = agentFromTitle(mark.text);
      // A title arriving before the shell printed a start mark (PowerShell has no preexec) still
      // means a program is running when it names an agent.
      const running = state.running || agent !== null;
      const next = agent ?? (state.running ? state.agent : null);
      // The same title again (an agent repainting its title) is no change: the same object comes back,
      // so nothing downstream re-renders.
      if (running === state.running && mark.text === state.title && next === state.agent) return state;
      return { running, title: mark.text, agent: next };
    }
  }
}

/** A title-only change reaches the pane (and the window's tab names) at most this late. */
export const TITLE_PACE_MS = 200;

/** Hands identities to `apply`: a change of `running` or `agent` at once (the hook and guess rules
 *  read those transitions), a change of the title alone at most once per TITLE_PACE_MS, the newest
 *  title winning. An agent that animates its title many times a second costs about five renders a
 *  second instead of one per frame of its spinner. */
export function identityPacer(apply: (id: Identity) => void, wait: (fn: () => void, ms: number) => () => void = (fn, ms) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
}) {
  let shown: Identity = IDLE;
  let pending: Identity | null = null;
  let cancel: (() => void) | null = null;
  const flush = () => {
    cancel?.();
    cancel = null;
    if (pending === null) return;
    const next = pending;
    pending = null;
    if (next === shown) return;
    shown = next;
    apply(next);
  };
  return {
    note(next: Identity) {
      pending = next;
      if (next.running !== shown.running || next.agent !== shown.agent) flush();
      else cancel ??= wait(flush, TITLE_PACE_MS);
    },
    flush,
    stop() {
      cancel?.();
      cancel = null;
      pending = null;
    },
  };
}

/** TERM-058: the agent a pane shows. The pane's own program (an agent launch) is what it is;
 *  hook-reported status already outranks title guesses in the header. In a shell pane the title
 *  guess counts, and what the live program says beats a `saved` record of a sleeping session. */
export function shownAgent(paneAgent: Agent, live: Identity, saved: Agent | null = null): Agent {
  if (paneAgent !== "shell") return paneAgent;
  if (live.agent) return live.agent;
  if (live.running) return "shell";
  return saved ?? "shell";
}

/** TERM-058: in a split tab the icon comes from the focused pane only; a plain shell there shows
 *  no sibling's agent. With no focused pane the first pane stands in. */
export function tabAgent(panes: { focused: boolean; agent: Agent }[]): Agent {
  if (panes.length === 0) return "shell";
  const f = panes.find((p) => p.focused) ?? panes[0];
  return f.agent;
}

/** TERM-058: the title a tab or pane shows: the user's own name wins, then the running program's
 *  title, then the automatic one. A title that is only a path or blank is not a program's title. */
export function followedTitle(custom: string | null | undefined, live: Identity, automatic: string): string {
  if (custom?.trim()) return custom.trim();
  const t = live.title?.trim();
  if (t && live.running && !/^(~|[a-zA-Z]:[\\/]|\\\\|\.{0,2}\/)/.test(t)) return t;
  return automatic;
}
