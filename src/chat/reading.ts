// Native chat, the window side of reading a transcript (CHAT-009; T-330). A chat that is hidden
// (its screen left, its window minimised) reads nothing and holds no retry timer; shown again it
// starts one new read whose first snapshot replaces whatever was stale. What was last read is kept
// per pane, for as long as the terminal behind the pane is the same one, so coming back shows the
// conversation at once, and a read that fails afterwards leaves it in place: a full-pane error
// appears only when nothing was kept.
import { applyRead, type ChatItem, type ChatRead } from "./model";
import { OLDER_LINES, pageIsCurrent, prependOlder } from "./page";

/** What the chat shows of its transcript: the conversation, what the reading says of it, and the error if any. */
export type Seen = { items: ChatItem[]; state: ChatRead["state"]; error: string | null; open: boolean; /** CHAT-008: cursor of the lines before the first one read; 0 or absent = the top. */ older?: number };

/** Nothing read yet. */
export const NOTHING: Seen = { items: [], state: "loading", error: null, open: false };

/** How long to wait before looking again after a failed call. */
export const FAILED_RETRY_MS = 10_000;

/** The last good view of each pane and the terminal session it was read from. */
const kept = new Map<number, { session: number | undefined; seen: Seen }>();
/** More panes than this are never open at once; the oldest view goes first. */
const KEPT_PANES = 32;

/** The pane's kept view, only if it was read from the same terminal session; otherwise it is thrown away. */
export function keptFor(pane: number, session: number | undefined): Seen | null {
  const k = kept.get(pane);
  if (!k) return null;
  if (k.session === session) return k.seen;
  kept.delete(pane);
  return null;
}

/** Remembers a view worth coming back to (one with messages in it). */
export function keepSeen(pane: number, session: number | undefined, seen: Seen) {
  if (seen.items.length === 0) return;
  kept.delete(pane);
  kept.set(pane, { session, seen });
  while (kept.size > KEPT_PANES) kept.delete(kept.keys().next().value as number);
}

export const forgetKept = (pane: number) => void kept.delete(pane);
export const forgetAllKept = () => {
  kept.clear();
  closing.clear();
  reading.clear();
};

/** FIX-2: the close of each pane's transcript that is still out. chat_close and chat_read are separate async commands that
 * run in no fixed order, so the next read for a pane waits for this (it could otherwise be served by the follower that is
 * about to be dropped, and its snapshot would replace the conversation that was kept). */
const closing = new Map<number, Promise<unknown>>();
/** FIX-2: the read each pane has out, so a hide can close again behind it (a read that starts after the close would otherwise
 * open a follower nobody closes). */
const reading = new Map<number, Promise<unknown>>();
const settled = (p: unknown): Promise<unknown> => Promise.resolve(p).then(() => {}, () => {});
const thenable = (x: unknown): x is PromiseLike<unknown> => typeof (x as { then?: unknown } | null)?.then === "function";

/** Folds one look into what is shown. `got`: the transcript's answer, or the reason the call failed.
 * `first`: this is the first look since the chat was shown, whose snapshot replaces whatever was
 * stale. A loading or error answer never takes a conversation off the screen. */
export function takeRead(prev: Seen, got: ChatRead | { failed: string }, first: boolean): Seen {
  const keptSome = prev.items.length > 0;
  if ("failed" in got) return keptSome ? prev : { ...NOTHING, state: "error", error: got.failed };
  if (got.state === "loading" || got.state === "error") {
    if (keptSome) return prev;
    return { items: [], state: got.state, error: got.error ?? null, open: false };
  }
  const fresh = first || got.reset;
  const items = fresh ? got.items : applyRead(prev.items, got);
  const older = fresh ? got.older : prev.older;
  return { items, state: got.state, error: null, open: got.open, ...(older ? { older } : {}) };
}

export type Timers = { set: (f: () => void, ms: number) => unknown; clear: (t: unknown) => void };

export type ReaderOptions = {
  pane: number;
  /** The terminal session behind the pane; kept messages from another one are thrown away. */
  session: number | undefined;
  /** True when the chat begins hidden: it reads nothing until `show`. */
  hidden: boolean;
  read: () => Promise<ChatRead>;
  /** CHAT-008: the page of lines before `cursor` (at most `lines` of them). Absent: the transcript cannot be paged back. */
  readEarlier?: (cursor: number, lines: number) => Promise<ChatRead>;
  /** Lets go of the transcript, so the next read starts from the top. FIX-2: return the call's promise so the next read
   * (of this or a new reader for the pane) waits for it. */
  close: () => void | PromiseLike<unknown>;
  onChange: (seen: Seen) => void;
  timers?: Timers;
};

/** Reads one pane's transcript while shown. */
export class ChatReader {
  seen: Seen;
  private on = false;
  private first = true;
  private turn = 0;
  private timer: unknown = undefined;
  private timers: Timers;
  /** CHAT-008: bumped when the chat is shown or hidden, so an older page that finishes after that is dropped. */
  private epoch = 0;
  private paging = false;

  constructor(private o: ReaderOptions) {
    this.timers = o.timers ?? { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };
    this.seen = keptFor(o.pane, o.session) ?? NOTHING;
    if (!o.hidden) this.show();
  }

  /** Starts reading: one new read, whose first snapshot replaces what is shown. */
  show() {
    if (this.on) return;
    this.on = true;
    this.epoch++;
    this.first = true;
    this.look();
  }

  /** Stops reading, cancels the pending retry, ignores a read still out, and lets go of the transcript. */
  hide() {
    if (!this.on) return;
    this.on = false;
    this.epoch++;
    this.turn++;
    this.stopTimer();
    keepSeen(this.o.pane, this.o.session, this.seen);
    const { pane, close } = this.o;
    const first = close();
    // FIX-2: a read still out may reach the transcript after this close; close again once it has settled.
    const out = reading.get(pane);
    const waits: Promise<unknown>[] = [];
    const earlier = closing.get(pane); // a close of this pane still out is waited for too, so the order is kept
    if (earlier) waits.push(earlier);
    if (thenable(first)) waits.push(settled(first));
    if (out) waits.push(settled(out).then(() => settled(close())));
    if (waits.length === 0) return;
    const pending: Promise<unknown> = Promise.all(waits).then(() => {});
    closing.set(pane, pending);
    void pending.then(() => void (closing.get(pane) === pending && closing.delete(pane)));
  }

  /** CHAT-008: fetches the next older page and puts it before what is shown. `before` runs just ahead of the change
   * (the view saves its reading position there); `failed` runs when the call itself failed. False when nothing was added: at the top, a page already out, the call
   * failed, or the view was replaced meanwhile (a page for a cursor that is no longer the view's own is dropped). */
  async loadEarlier(before?: () => void, failed?: () => void): Promise<boolean> {
    const cursor = this.seen.older ?? 0;
    const { readEarlier } = this.o;
    if (!this.on || this.paging || cursor <= 0 || !readEarlier) return false;
    const started = this.epoch;
    this.paging = true;
    try {
      const got = await readEarlier(cursor, OLDER_LINES);
      if (!got.earlier || !this.on || !pageIsCurrent(started, this.epoch) || (this.seen.older ?? 0) !== cursor) return false;
      before?.();
      this.seen = { ...this.seen, items: prependOlder(this.seen.items, got.items), older: got.older ?? 0 };
      keepSeen(this.o.pane, this.o.session, this.seen);
      this.o.onChange(this.seen);
      return true;
    } catch {
      failed?.();
      return false;
    } finally {
      this.paging = false;
    }
  }

  private stopTimer() {
    if (this.timer !== undefined) this.timers.clear(this.timer);
    this.timer = undefined;
  }

  private look() {
    const mine = ++this.turn;
    const again = (ms: number) => {
      this.timer = this.timers.set(() => {
        this.timer = undefined;
        if (this.on && mine === this.turn) this.look();
      }, ms);
    };
    const take = (got: ChatRead | { failed: string }) => {
      if (!this.on || mine !== this.turn) return;
      const good = !("failed" in got) && (got.state === "ready" || got.state === "empty");
      this.seen = takeRead(this.seen, got, this.first);
      if (good) this.first = false;
      keepSeen(this.o.pane, this.o.session, this.seen);
      this.o.onChange(this.seen);
      again("failed" in got ? FAILED_RETRY_MS : got.retryMs);
    };
    // FIX-2: the read waits for a close still out for this pane; a chat hidden meanwhile never starts it.
    const run = (): Promise<ChatRead | null> => (this.on && mine === this.turn ? this.o.read() : Promise.resolve(null));
    const wait = closing.get(this.o.pane);
    const read = wait ? wait.then(run) : run();
    const pane = this.o.pane;
    reading.set(pane, read);
    void settled(read).then(() => void (reading.get(pane) === read && reading.delete(pane)));
    read.then((got) => void (got && take(got)), (e) => take({ failed: String(e) }));
  }
}

/** Calls `change` with whether the window's page is hidden (minimised, or another window on top of a hidden tab). */
export function watchHidden(doc: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">, change: (hidden: boolean) => void): () => void {
  const on = () => change(doc.visibilityState === "hidden");
  doc.addEventListener("visibilitychange", on);
  return () => doc.removeEventListener("visibilitychange", on);
}
