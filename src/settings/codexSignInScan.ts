// T-139-d (ACCT-023 rule, ACCT-012 notice): a sign-in error that Codex prints in a pane flags that
// pane's managed Codex account, so the main-window notice offers "Sign in again".
// Bounded on purpose: only panes started on a managed Codex account are read (never Codex's
// system-default login, never a shell or another agent); only the last TAIL_BYTES of each output
// chunk are decoded; at most CARRY characters of letters are kept per pane between chunks (to catch a
// phrase split across two chunks), and nothing else of the pane's output is stored; a pane reports
// at most once per REPORT_EVERY_MS. The match is one short fixed phrase from Codex's own public
// source (openai/codex, Apache-2.0; see PROVENANCE.md), compared without spacing, colours or
// cursor moves so a wrapped or coloured line still matches.
import { invoke } from "@tauri-apps/api/core";
import { onTerminalOutput, onTerminalExit } from "../terminal/outputBus";
import { chunkBytes } from "../terminal/codec";

/** The fixed phrase every Codex "could not refresh your sign-in" message starts with, spacing removed. */
export const PHRASE = "accesstokencouldnotberefreshed";
export const TAIL_BYTES = 2048;
const CARRY = 64;
export const REPORT_EVERY_MS = 60_000;

/** Only the end of a chunk: at most TAIL_BYTES, whatever the chunk size (DT-C246: a view, no copy). */
export function tailBytes(bytes: Uint8Array): Uint8Array {
  return bytes.length > TAIL_BYTES ? bytes.subarray(bytes.length - TAIL_BYTES) : bytes;
}

/** Terminal text without escape sequences, control characters or spacing, lower-cased. */
export function plain(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)?/g, "") // window titles and other OSC strings
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "") // colours, cursor moves, erases
    .replace(/\x1b[@-_]/g, "")
    .replace(/[\s\x00-\x1f\x7f]+/g, "")
    .toLowerCase();
}

export class CodexSignInScan {
  private accounts = new Map<number, string>();
  private windows = new Map<number, string>();
  private reported = new Map<number, number>();
  private decoder = new TextDecoder("utf-8");

  /** A pane's terminal started; `account` is the managed Codex account it runs on, null for none. */
  watch(terminal: number, account: string | null) {
    this.forget(terminal);
    if (account) this.accounts.set(terminal, account);
  }

  forget(terminal: number) {
    this.accounts.delete(terminal);
    this.windows.delete(terminal);
    this.reported.delete(terminal);
  }

  /** Characters held for this pane between chunks (test hook; never more than CARRY). */
  carried(terminal: number): number {
    return this.windows.get(terminal)?.length ?? 0;
  }

  /** One output chunk's bytes; answers the account to flag, or null. */
  feed(terminal: number, bytes: Uint8Array, now: number): string | null {
    const account = this.accounts.get(terminal);
    if (!account) return null;
    const text = (this.windows.get(terminal) ?? "") + plain(this.decoder.decode(tailBytes(bytes)));
    const hit = text.includes(PHRASE);
    this.windows.set(terminal, hit ? "" : text.slice(-CARRY));
    if (!hit) return null;
    const last = this.reported.get(terminal);
    if (last !== undefined && now - last < REPORT_EVERY_MS) return null;
    this.reported.set(terminal, now);
    return account;
  }
}

const scan = new CodexSignInScan();

/** App.tsx's onPty hands each pane's terminal and (Codex only) its managed account here. */
export function watchCodexSignIn(terminal: number, account: string | null) {
  scan.watch(terminal, account);
}

/** Started once by the main-window notice; answers a stop function. */
export function startCodexSignInScan(): () => void {
  const offs = [
    onTerminalOutput((e) => {
      const account = scan.feed(e.id, chunkBytes(e), Date.now());
      if (account) invoke("codex_account_sign_in_printed", { id: account }).catch(() => {});
    }),
    onTerminalExit<{ id: number }>((e) => scan.forget(e.payload.id)),
  ];
  return () => offs.forEach((o) => void o.then((u) => u()).catch(() => {}));
}
