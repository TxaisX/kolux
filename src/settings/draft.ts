// SET-036 (T-181): a settings text field that never loses what was typed. The controller holds the
// text the user is typing apart from the saved value: it saves after a short pause, straight away on
// leaving, keeps keystrokes made while a save runs, saves in order, keeps the text when a save fails,
// never saves input-method composition half-way, and ignores an update from outside while the user
// has unsaved text (the draft survives). A number box can say which text is ready for the pause save
// (`ready`): half-typed digits wait, so the box never rewrites itself under the user's fingers.

export const DRAFT_PAUSE_MS = 600;

export type DraftState = { text: string; saved: string; dirty: boolean; saving: boolean; composing: boolean; error: string | null };

type Timer = { set(fn: () => void, ms: number): unknown; clear(t: unknown): void };
const realTimer: Timer = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };

export type DraftOptions = {
  /** Stores `text`; rejects when the save fails. It may resolve to the text that was really stored
   * (a clamped number: typed "5", stored "200"); the field then shows that text. */
  save: (text: string) => Promise<unknown>;
  /** Whether `text` is worth saving after a pause (a number box: only a finished number in its normal
   * form). Text that is not ready waits: it is saved, and for a number clamped, only on leaving the
   * field, changing page or closing the window. Default: every text is ready. */
  ready?: (text: string) => boolean;
  pause?: number;
  timer?: Timer;
};

export function createDraft(initial: string, opts: DraftOptions) {
  const pause = opts.pause ?? DRAFT_PAUSE_MS;
  const timer = opts.timer ?? realTimer;
  const ready = opts.ready ?? (() => true);
  let s: DraftState = { text: initial, saved: initial, dirty: false, saving: false, composing: false, error: null };
  let wait: unknown = null;
  let running: Promise<void> | null = null;
  let everything = false; // a leave or a close came while a pause save ran: text that is not ready saves too
  const listeners = new Set<() => void>();
  const set = (patch: Partial<DraftState>) => {
    s = { ...s, ...patch };
    s.dirty = s.text !== s.saved;
    listeners.forEach((l) => l());
  };
  const stop = () => {
    if (wait !== null) timer.clear(wait);
    wait = null;
  };
  const arm = () => {
    stop();
    if (s.composing || !s.dirty || !ready(s.text)) return;
    wait = timer.set(() => {
      wait = null;
      void run(false);
    }, pause);
  };
  /** Saves until the stored text is the typed text. One save at a time; a keystroke made meanwhile
   * is picked up by the next round, each on top of the last stored result. */
  const loop = async () => {
    for (;;) {
      if (!s.dirty || s.composing || !(everything || ready(s.text))) return;
      const sent = s.text;
      set({ saving: true });
      let stored = sent;
      try {
        const r = await opts.save(sent);
        if (typeof r === "string") stored = r;
      } catch (e) {
        set({ saving: false, error: e instanceof Error ? e.message : String(e) }); // the typed text stays for another try
        return;
      }
      // the box takes the stored text unless a keystroke was made meanwhile (that one saves next round)
      set({ saved: stored, saving: false, error: null, ...(s.text === sent ? { text: stored } : {}) });
    }
  };
  /** `all` is a leave or a close: whatever is typed saves. A pause save (`all` false) saves ready text only. */
  function run(all: boolean): Promise<void> {
    stop();
    if (all) everything = true;
    if (!running) {
      running = loop().finally(() => {
        running = null;
        everything = false;
      });
    }
    return running;
  }
  const flush = () => run(true);
  return {
    state: () => s,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    /** A keystroke or paste. */
    type(text: string) {
      everything = false; // typing again after a leave: back to pause rules until the next leave
      set({ text });
      arm();
    },
    compositionStart() {
      stop();
      set({ composing: true });
    },
    /** The composition finished with `text` in the field. */
    compositionEnd(text: string) {
      everything = false;
      set({ composing: false, text });
      arm();
    },
    /** Leaving the field, changing page or closing the window: save now. The browser ends any
     * composition when the field loses focus, so what is on screen is final. */
    leave(): Promise<void> {
      if (s.composing) set({ composing: false });
      return flush();
    },
    flush,
    /** The stored value changed from outside (another window, an import). A draft with unsaved text
     * or a save in progress is kept; otherwise the field takes the new value. */
    outside(value: string) {
      if (s.dirty || s.saving || s.composing) return false;
      set({ text: value, saved: value, error: null });
      return true;
    },
    /** Puts the field back to the stored text (Escape). */
    discard() {
      stop();
      set({ text: s.saved, composing: false, error: null });
    },
    dispose() {
      stop();
    },
  };
}
export type Draft = ReturnType<typeof createDraft>;
