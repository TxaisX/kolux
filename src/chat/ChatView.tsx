// The chat view of one terminal-backed agent session (CHAT-006, CHAT-010; T-325): loading while
// the transcript is not written yet, then the conversation so far, then each new turn as the
// agent records it, with the agent's work folded into steps, diff cards and a subagent roster
// (T-326). Thin on purpose: the Agents screen (T-050) mounts it in its body; AgentsChat (T-050-b)
// decides chat or terminal and carries the Show terminal switch; a finished turn's reply can be
// handed to another session's box (T-080).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { locale } from "../language";
import "./chat.css";
import { fold, isFullPath, thoughtIds as idsOf, toggled, type View } from "./steps";
import { NoticeRow, PlanRow, StepRow, ThoughtRow } from "./StepRows";
import { SHELL_OFFER, agentsView, handOver, handTargets, viewedFirst, capPending, chatCovers, combine, liveOffer, pickChat, typingInto, lastReply, lastReplyItem, previewToShow, stamp, type ChatItem, type ChatRead, type Extra, type Offer, type Pending, type Preview, type Row, type Support } from "./model";
import { useTurnPreview } from "../terminal/turnRead";
import { Composer, type ComposerHandle } from "./MessageBox";
import { readModel } from "./controls";
import { FIRST_LINES, hiddenCount, keepPosition, loadLabel, visibleRows } from "./page";
import { chatZoom, setChatZoom, stepZoom, zoomChord, zoomLabel } from "./zoom";
import { EARLIER_FAILED_NOTE, NOTE_MS, ZOOM_SHOWN_MS, outside, pollMs, selfClearing, useCopy, useDismiss } from "./ux";
import { draftOf, forwardsToBox, keepDraft, nearBottom } from "./composer";
import { watchEscape } from "../switcher/accounts";
import { sessionLabel } from "../agents/rail";
import { NO_TERMINAL_NOTE, boxSend, hearStates, holdReading, stopPane, writeTerminal } from "./send";
import { answerCard, askOf, cardOf, dismissAsk, hearAsks, subscribeAsk } from "./ask";
import { PermissionCard } from "./PermissionCard";
import { QuestionCard } from "./QuestionCard";
import { answerSteps, closeQuestion, openQuestion, sendAnswer, type Pick } from "./question";
import { BrowserChoice, ChatText, LinkContext, type LinkHost } from "./ChatText";
import { printedPaths } from "./chatLinks";
import { ChatReader, NOTHING, watchHidden, type Seen } from "./reading";
import type { WrittenFile } from "./steps";
import { CANNOT_STOP_NOTE, STOPPING_NOTE } from "./stop";
import type { Answer } from "../terminal/permissionAnswer";

/** `terminal`: the program session the pane types into (the window's own pane-to-terminal map).
 * `program`: what Kolux started in the pane; null for a plain shell (T-050-b: no chat, no switch
 * until an agent is detected in it, T-050-c). */
export type ChatPane = { key: number; cwd: string | null; title?: string; terminal?: number; program?: string | null };

/** `hookState`: the window's hook reading for the pane (permission, waiting, working, ...), when it has
 * one; `stateOf`: the same readings read live by pane key, so a send checks its own pane at every write.
 * `ptyOf`: the pane's program session, asked at send time. `target`: names the pane the box types into.
 * `aside`: drawn at the top right (the Agents screen's Show terminal switch). `hand`: VIEW-020, the
 * sessions a finished turn's reply can be handed to, and what handing it does. */
export type Hand = { targets: { key: number; label: string }[]; onHand: (key: number, text: string, replyId: string) => void; /** Why the last hand-over was refused (FIX-SOON 1), shown beside the menu while the reply it was for is still the one shown (FIX-5). */ note?: string | null; /** The id of that reply (FIX-6: not its words, so a newer reply with the same words does not inherit the note). */ noteFor?: string | null };
/** CHAT-025, CHAT-023: what the window gives a chat to open things with. `onOpenLink`: Kolux's own viewer for a web page;
 * `onOpenFile`: the editor at a line and column; `inKolux`: the setting that makes Kolux's viewer the main choice for a
 * web link; `onReview`: opens the plan review for this pane's pending plan. Every one is optional: a chat without them
 * hands links to the system and shows the plan inside the card. */
export type ChatOpen = { onOpenLink?: (url: string) => void; onOpenFile?: (path: string, line?: number, column?: number) => void; inKolux?: boolean; onReview?: (key: number, plan: string, cut: boolean) => void };
/** The card's note when the prompt it was drawn for was already answered or has gone. */
export const GONE_NOTE = "That question was already answered. Look at the terminal.";
/** The refusal of a hand-over and the id of the reply it was refused for. */
export type HandNote = { text: string; forResult: string };
export default function ChatView({ pane, agent, preview = null, pending = [], hookState, stateOf, ptyOf, target = null, aside, hand, open: opener, hidden: hiddenProp, onTerminal }: { pane: ChatPane; agent?: string; preview?: Preview | null; pending?: Pending[]; hookState?: string; stateOf?: (key: number) => string | undefined; ptyOf?: (key: number) => number | undefined; target?: string | null; aside?: ReactNode; hand?: Hand; open?: ChatOpen; /** CHAT-009: true while the screen hides the chat; it reads nothing then. */ hidden?: boolean; /** CHAT-024: shows the session's own terminal (Codex's model picker lives there). */ onTerminal?: () => void }) {
  // CHAT-009 (T-330): what the transcript last said, kept per pane while the chat is hidden (reading.ts).
  const [seen, setSeen] = useState<Seen>(NOTHING);
  const readerRef = useRef<ChatReader | null>(null);
  const hookSeq = useRef(0);
  const { items, state, error, open } = seen;
  const [extras, setExtras] = useState<Extra[]>([]);
  // CHAT-022 (council FIX-1): the box sends only while Kolux can see the agent is not asking in its
  // terminal; a send's keys would land in a menu and its Enter would pick the default (Yes).
  // `setHeard` only redraws the box when the pane's hook event arrives; the reading itself is send.ts's.
  const [, setHeard] = useState<string | undefined>(undefined);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => void hearStates(listen).catch(() => {}), []);
  // CHAT-023: every pane's permission prompts are counted for the whole window; the card redraws when this pane's record moves.
  const [, setAsked] = useState(0);
  const [, setAskedAgain] = useState(0); // CHAT-022: redraws after a question card is dismissed
  useEffect(() => void hearAsks(listen).catch(() => {}), []);
  useEffect(() => subscribeAsk(() => setAsked((n) => n + 1)), []);

  useEffect(() => {
    setHeard(undefined);
    setNote(null);
    // CHAT-010: what the hooks say arrives first; the transcript's version replaces it.
    const off = listen<{ paneKey: number; reply?: string; state?: string }>("agent-status", (e) => {
      if (e.payload.paneKey !== pane.key) return;
      // CHAT-022: the hooks' own reading, for the box's note (a send reads it live through send.ts).
      if (e.payload.state !== undefined) setHeard(e.payload.state);
      if (!e.payload.reply) return;
      const text = e.payload.reply;
      // A hook reply has no id of its own; a counter keeps two replies in the same millisecond
      // from sharing a React key.
      hookSeq.current += 1;
      const at = Date.now();
      setExtras((xs) => (xs.some((x) => x.text === text) ? xs : [...xs.slice(-20), { id: `hook-${at}-${hookSeq.current}`, role: "assistant", text, at }]));
    });
    return () => void off.then((u) => u()).catch(() => {});
  }, [pane.key]);

  // CHAT-020: what this view sent and the transcript has not confirmed yet (at most 8 per pane).
  const [sent, setSent] = useState<Pending[]>([]);
  useEffect(() => setSent([]), [pane.key]);
  const allPending = useMemo(() => capPending([...pending, ...sent]), [pending, sent]);
  // T-325-c (CHAT-011 / CHAT-010): the reply read off the pane's terminal while the turn runs, unless a caller passes one.
  const live = useTurnPreview(pane.key, open && !hiddenProp);
  const shownPreview = preview ?? live;
  const rows = useMemo(() => combine(items, extras, previewToShow(shownPreview, open, lastReply(items)), allPending), [items, extras, shownPreview, open, allPending]);
  const key = pane.key;
  const terminalOf = (k: number) => (k === key && pane.terminal !== undefined ? pane.terminal : ptyOf?.(k));
  // CHAT-009: a hidden chat (its screen left, `hidden`, or the window's page hidden) reads nothing; shown again it
  // opens on its last good view and one new read replaces it. A new terminal behind the pane drops the kept view.
  const session = terminalOf(key);
  const [pageHidden, setPageHidden] = useState(() => typeof document !== "undefined" && document.visibilityState === "hidden");
  useEffect(() => watchHidden(document, setPageHidden), []);
  const paused = !!hiddenProp || pageHidden;
  useLayoutEffect(() => {
    const reader = new ChatReader({
      pane: key,
      session,
      hidden: paused,
      // T-050-c: the terminal and the pane's folder serve a transcript Kolux did not start.
      read: () => invoke<ChatRead>("chat_read", { paneKey: key, terminal: session, cwd: pane.cwd, limit: FIRST_LINES }),
      // CHAT-008: older lines come from the backend on demand, never the whole transcript at once.
      readEarlier: (cursor, limit) => invoke<ChatRead>("chat_read", { paneKey: key, terminal: session, cwd: pane.cwd, cursor, limit }),
      close: () => invoke("chat_close", { paneKey: key }).catch(() => {}),
      onChange: setSeen,
    });
    readerRef.current = reader;
    setSeen(reader.seen);
    return () => {
      if (readerRef.current === reader) readerRef.current = null;
      reader.hide();
    };
  }, [key, session, paused]);
  // Council FIX-2: a reading from the pane's earlier terminal does not count (FS4).
  const held = holdReading(key, hookState, stateOf !== undefined, terminalOf(key));
  /** False when nothing was sent, so the box keeps the text; the box then says why (council FIX-2, FS3). */
  const send = (text: string): boolean => {
    const id = `sent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const failed = () => setSent((xs) => xs.map((x) => (x.id === id ? { ...x, failed: true } : x)));
    // CHAT-022: the send is bound to this pane; a menu it opens mid-send drops the rest, the Enter above all.
    return boxSend(key, agent, text, { terminalOf, stateOf, write: writeTerminal }, {
      note: setNote,
      onQueued: () => {
        setSent((xs) => capPending([...xs, { id, text, at: Date.now() }]));
        stick.current = true;
      },
      onFailed: failed,
      // CHAT-018: Stop cancelled this send before its Enter; the waiting row goes (nothing was sent).
      onCancelled: () => setSent((xs) => xs.filter((x) => x.id !== id)),
    });
  };
  // CHAT-018: Stop. The box says so once; the note goes when the turn is over.
  const stop = () => {
    setNote(STOPPING_NOTE);
    stopPane(key, { terminalOf, stateOf, write: writeTerminal }).then(
      (r) => setNote(r === "stopped" ? STOPPING_NOTE : CANNOT_STOP_NOTE),
      () => setNote(CANNOT_STOP_NOTE),
    );
  };
  useEffect(() => {
    if (!open) setNote((n) => (n === STOPPING_NOTE ? null : n));
  }, [open]);
  // A note under the box clears itself after a while (Stopping... is cleared by the turn ending instead).
  useEffect(() => {
    if (!selfClearing(note, STOPPING_NOTE)) return;
    const t = setTimeout(() => setNote((n) => (n === note ? null : n)), NOTE_MS);
    return () => clearTimeout(t);
  }, [note]);
  // CHAT-023: the permission card, while the agent's hook says it is asking and the user has not answered.
  const card = cardOf(agent, askOf(key), terminalOf(key), stateOf ? () => stateOf(key) : undefined);
  const answer = (a: Answer) => {
    if (!card || !agent) return;
    answerCard(key, agent, a, card.drawnAt, { terminalOf, stateOf, write: writeTerminal }).then(
      (r) => setNote(r === "gone" ? GONE_NOTE : r === "no-terminal" ? NO_TERMINAL_NOTE : null),
      () => setNote(CANNOT_STOP_NOTE),
    );
  };
  // CHAT-022: the agent's multiple-choice question as a card; its answer is typed in as the option numbers (question.ts).
  const waiting = stateOf ? stateOf(key) === "waiting" : hookState === undefined ? undefined : hookState === "waiting";
  const asking = agent === "claude" || agent === "openclaude" || agent === "codex" ? openQuestion(items, waiting) : null;
  const askId = useRef<string | undefined>(undefined);
  askId.current = asking?.id;
  const [typing, setTyping] = useState<{ id: string; cancel: () => void } | null>(null);
  useEffect(() => setTyping(null), [key]);
  const submitQuestion = (picks: Pick[]) => {
    if (!asking) return;
    const steps = answerSteps(asking.questions, picks);
    if (steps.length === 0) return setNote("That answer cannot be typed from here. Answer in the terminal.");
    const run = sendAnswer(key, asking, steps, { terminalOf, stateOf, write: writeTerminal, current: () => askId.current });
    if (run.cancel) setTyping({ id: asking.id, cancel: run.cancel });
    run.done.then((r) => {
      setTyping(null);
      if (r === "no-terminal") return setNote(NO_TERMINAL_NOTE);
      if (r === "sent") return void (closeQuestion(asking.sig), setNote(null));
      setNote("The answer was stopped part way. Look at the terminal.");
    });
  };
  // CHAT-025: links in the agent's replies. Only files the agent printed recently open.
  const [menu, setMenu] = useState<{ url: string; at: { x: number; y: number } } | null>(null);
  useEffect(() => setMenu(null), [pane.key]);
  const printed = useMemo(() => printedPaths(items, pane.cwd), [items, pane.cwd]);
  const host: LinkHost = {
    cwd: pane.cwd,
    printed,
    mac: /^Mac/i.test(navigator.platform),
    inKolux: !!opener?.inKolux,
    onOpenLink: opener?.onOpenLink,
    onOpenFile: opener?.onOpenFile,
    say: setNote,
    chooseBrowser: (url, at) => setMenu({ url, at }),
  };
  /** True when the link opened in an in-app pane (which takes focus); false for the system browser. */
  const pickBrowser = (where: "kolux" | "system"): boolean => {
    if (!menu) return false;
    const inApp = where === "kolux" && !!opener?.onOpenLink;
    if (inApp) opener!.onOpenLink!(menu.url);
    else invoke("open_external", { url: menu.url }).catch((e) => setNote(String(e)));
    setMenu(null);
    return inApp;
  };
  // CHAT-027: within 48 px of the bottom the view follows new output; further up it holds still.
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false);
  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    stick.current = nearBottom(el);
    setAway(!stick.current);
  };
  const toBottom = () => {
    const el = list.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stick.current = true;
    setAway(false);
  };
  const box = useRef<ComposerHandle>(null);
  // T-050-b: once the chat covers the terminal, keys must not keep going to the hidden terminal.
  const covers = chatCovers(state);
  // VIEW-020: a finished session's result, the last reply once the turn is over.
  const head = headOf(items, open, hand);
  useEffect(() => {
    if (covers && document.activeElement?.closest(".grid.agents")) box.current?.focus();
  }, [covers]);
  // CHAT-017: typing anywhere in the chat pane goes to the box; Backspace or Delete moves focus there.
  // CHAT-026: Ctrl or Cmd with plus, minus or zero zooms the chat text, whichever part of the chat has focus.
  const [zoom, setZoom] = useState(chatZoom);
  const [zoomShown, setZoomShown] = useState(false);
  useEffect(() => {
    if (!zoomShown) return;
    const t = setTimeout(() => setZoomShown(false), ZOOM_SHOWN_MS);
    return () => clearTimeout(t);
  }, [zoomShown, zoom]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const how = zoomChord({ key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, isComposing: e.nativeEvent.isComposing });
    if (how) {
      e.preventDefault();
      e.stopPropagation();
      setChatZoom(stepZoom(chatZoom(), how));
      setZoomShown(true);
      return setZoom(chatZoom());
    }
    const t = e.target as HTMLElement;
    if (t.closest("textarea, input, select, [contenteditable]")) return;
    if (t.closest("button, a") && (e.key === " " || e.key === "Enter")) return;
    if (forwardsToBox({ key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, isComposing: e.nativeEvent.isComposing })) box.current?.focus();
  };
  // CHAT-008: the newest 300 messages show first; each press of Load earlier messages adds 200 older ones.
  const [pages, setPages] = useState(0);
  const shownRows = useMemo(() => visibleRows(rows, pages), [rows, pages]);
  const views = useMemo(() => fold(shownRows, open, pane.cwd), [shownRows, open, pane.cwd]);
  const [earlierFailed, setEarlierFailed] = useState(false);
  useEffect(() => setEarlierFailed(false), [key]);
  const loadEarlier = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const earlierLabel = loadLabel(rows.length, pages, seen.older ?? 0);
  const more = () => {
    const showMore = () => {
      const el = list.current;
      if (el) loadEarlier.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
      stick.current = false;
      setPages((p) => p + 1);
    };
    // Rows already read come first; once all are shown, the next older page is fetched from the backend.
    if (hiddenCount(rows.length, pages) > 0) return showMore();
    setEarlierFailed(false);
    void readerRef.current?.loadEarlier(showMore, () => setEarlierFailed(true));
  };
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    if (loadEarlier.current) {
      // The same message stays where it was while older ones appear above it.
      el.scrollTop = keepPosition(loadEarlier.current, el.scrollHeight);
      loadEarlier.current = null;
    } else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [views]);
  const shownModel = useMemo(() => (agent ? readModel(agent, items) : null), [agent, items]);
  const [full, setFull] = useState<string | null>(null);
  useDismiss(full !== null, () => setFull(null), ".chat-full");
  // STAT-053: Thought rows start folded; the toolbar opens or folds them all.
  const [thoughts, setThoughts] = useState<Set<string>>(() => new Set());
  const thoughtIds = idsOf(items);
  const toggle = (id: string) => setThoughts((t) => toggled(t, id));

  return (
    <LinkContext.Provider value={host}>
    <div className={`chat${covers ? " cover" : ""}`} aria-label="Chat" onKeyDown={onKeyDown} style={{ "--chat-zoom": zoom } as CSSProperties}>
      {(aside || head.result) && (
        <div className="chat-head">
          <ChatHead {...head} hand={hand} aside={aside} />
        </div>
      )}
      {state === "loading" && rows.length === 0 && <div className="chat-state" role="status">Loading the conversation…</div>}
      {state === "error" && <div className="chat-state chat-error" role="alert">{error}</div>}
      {state === "empty" && rows.length === 0 && <div className="chat-state">No messages yet. What you and the agent say shows up here.</div>}
      {thoughtIds.length > 0 && (
        <div className="chat-toolbar">
          <button type="button" onClick={() => setThoughts(new Set(thoughtIds))}>Expand thoughts</button>
          <button type="button" onClick={() => setThoughts(new Set())}>Collapse thoughts</button>
        </div>
      )}
      <div className="chat-list" ref={list} onScroll={onScroll}>
        {earlierLabel && (
          <button type="button" className="chat-load-earlier" onClick={more}>
            {earlierLabel}
          </button>
        )}
        {earlierLabel && earlierFailed && <div className="chat-fail" role="alert">{EARLIER_FAILED_NOTE}</div>}
        {views.map((v) => (
          <ViewRow key={`${v.row}-${v.id}`} view={v} onImage={setFull} thoughts={thoughts} onToggle={toggle} hand={hand} />
        ))}
      </div>
      {away && (
        <button type="button" className="chat-jump" onClick={toBottom}>
          Jump to latest
        </button>
      )}
      {target && <div className="chat-target" role="status">{target}</div>}
      {card && <PermissionCard card={card} onAllow={() => answer("approve")} onDeny={() => answer("deny")} onReview={opener?.onReview ? () => opener.onReview?.(key, card.plan ?? "", !!card.planCut) : undefined} onDismiss={() => dismissAsk(key, card.drawnAt)} />}
      {asking && (
        <QuestionCard
          key={asking.id}
          card={asking}
          sending={typing?.id === asking.id}
          onSubmit={submitQuestion}
          onCancel={() => typing?.cancel()}
          onDismiss={() => (closeQuestion(asking.sig), setAskedAgain((n) => n + 1))}
        />
      )}
      {menu && <BrowserChoice url={menu.url} at={menu.at} onPick={pickBrowser} onClose={() => setMenu(null)} />}
      <Composer ref={box} paneKey={pane.key} live={terminalOf(key) !== undefined} blocked={held} note={note ?? undefined} onSend={send} working={open} onStop={stop} agent={agent} cwd={pane.cwd} shownModel={shownModel} onTerminal={onTerminal} />
      {/* The live region stays mounted and only its text changes: a region created with its text is skipped by screen readers. */}
      <div className="chat-zoom" role="status">{zoomShown ? zoomLabel(zoom) : ""}</div>
      {full && (
        <button type="button" className="chat-full" aria-label="Close image" onClick={() => setFull(null)}>
          <img src={full} alt="Attached" />
        </button>
      )}
    </div>
    </LinkContext.Provider>
  );
}

function ViewRow({ view, onImage, thoughts, onToggle, hand }: { view: View; onImage: (src: string) => void; thoughts: Set<string>; onToggle: (id: string) => void; hand?: Hand }) {
  // CHAT-028: the files a finished turn wrote; a pick puts the path in the other agent's draft (never sent).
  if (view.row === "files") return <FilesRow id={view.id} files={view.files} targets={hand?.targets ?? []} onSend={(to, path) => hand?.onHand(to, path, view.id)} note={hand?.noteFor === view.id ? (hand.note ?? null) : null} />;
  if (view.row !== "message") return view.row === "preview" || view.row === "pending" ? <ChatRow row={view} onImage={onImage} /> : <StepRow view={view} />;
  if (view.kind === "thought") return <ThoughtRow item={view} open={thoughts.has(view.id)} onToggle={() => onToggle(view.id)} />;
  if (view.kind === "plan") return <PlanRow item={view} />;
  if (view.kind === "notice") return <NoticeRow item={view} />;
  if (view.kind === "compact") return <div className="chat-divider" role="separator"><span>{view.text}</span></div>;
  return <ChatRow row={view} onImage={onImage} />;
}

function ChatRow({ row, onImage }: { row: Row; onImage: (src: string) => void }) {
  const [copyText, copy] = useCopy("Copy");
  if (row.row === "preview") return <div className="chat-msg assistant preview"><div className="chat-text">{row.text}</div></div>;
  if (row.row === "pending")
    return (
      <div className={`chat-msg user pending${row.failed ? " failed" : ""}`}>
        <div className="chat-text">{row.text}</div>
        {row.failed && <div className="chat-fail" role="alert">This message did not arrive. Look at the terminal.</div>}
      </div>
    );
  if (row.role === "status") return <div className="chat-status" role="status">{row.text}</div>;
  const when = row.at !== undefined ? stamp(row.at, locale()) : null;
  return (
    <div className={`chat-msg ${row.role}${row.kind === "command" ? " command" : ""}`}>
      {row.images && row.images.length > 0 && (
        <div className="chat-images">
          {row.images.map((src, i) => (
            <button key={i} type="button" className="chat-thumb" aria-label="Open image at full size" onClick={() => onImage(src)}>
              <img src={src} alt="Attached" />
            </button>
          ))}
        </div>
      )}
      {row.text && <div className="chat-text">{row.role === "assistant" && row.kind === "text" ? <ChatText text={row.text} /> : row.text}</div>}
      <div className="chat-meta">
        {when && <time title={when.full}>{when.short}</time>}
        <button type="button" className="chat-copy" onClick={() => copy(row.text)}>{copyText}</button>
        <button type="button" className="chat-copy" title="Scroll the chat so this message starts at the top" onClick={(e) => e.currentTarget.closest(".chat-msg")?.scrollIntoView({ block: "start" })}>
          Scroll to start
        </button>
      </div>
    </div>
  );
}

/** VIEW-020: the reply the head offers to hand over, with its id (FIX-7: one place makes both, so the
 * id cannot be left out); none while a turn is open or when there is nowhere to send it. */
export function headOf(items: ChatItem[], open: boolean, hand?: Hand): { result: string | undefined; resultId: string | undefined } {
  const item = !open && hand && hand.targets.length > 0 ? lastReplyItem(items) : undefined;
  return { result: item?.text, resultId: item?.id };
}

/** The head of a chat: the Send result to menu and, beside it, why the last hand-over was refused,
 * but only while that same reply is the one shown (review of 6c0ea802, AFTER 2); then the aside. */
export function ChatHead({ result, resultId, hand, aside }: { result: string | undefined; resultId: string | undefined; hand?: Hand; aside?: ReactNode }) {
  return (
    <>
      {result && resultId && hand && <HandOff targets={hand.targets} onPick={(k) => hand.onHand(k, result, resultId)} />}
      {result && resultId && hand?.note && hand.noteFor === resultId && <span className="chat-hand-note" role="status">{hand.note}</span>}
      {aside}
    </>
  );
}

/** VIEW-020 and FIX-SOON 1: the Hand the Agents screen gives the chat of pane `key`. Handing a reply
 * over goes through `handOver`, which refuses a too-long one and keeps the draft; `say` stores why. */
export function makeHand(a: {
  panes: ChatPane[];
  key: number;
  offers: Record<number, Offer | undefined>;
  viewed: readonly number[];
  taskOf?: (key: number) => string | undefined;
  note: HandNote | null;
  setNote: (n: HandNote | null) => void;
  onPick?: (key: number) => void;
  draftOf: (key: number) => string;
  keepDraft: (key: number, text: string) => void;
}): Hand {
  return {
    targets: handTargets(a.panes, a.key, a.offers, a.viewed).map((p) => ({ key: p.key, label: sessionLabel(p, a.taskOf?.(p.key)) })),
    note: a.note?.text ?? null,
    noteFor: a.note?.forResult ?? null,
    onHand: (to, text, replyId) => {
      a.setNote(null);
      const label = sessionLabel(a.panes.find((p) => p.key === to) ?? { key: to, cwd: null }, a.taskOf?.(to));
      handOver(to, label, text, { draftOf: a.draftOf, keepDraft: a.keepDraft, pick: (k) => a.onPick?.(k), say: (t) => a.setNote({ text: t, forResult: replyId }) });
    },
  };
}

/** The Agents screen's chat: the picked pane's chat when it can show one (`pickChat`). `hook`: the
 * window's hook readings by pane, for the box's note; `stateOf`: the same readings read live, so a
 * send stops on its own pane's menu even after the screen moved to another pane. */
export function AgentsChat({ panes, focused, ptyOf, hook, stateOf, onPick, taskOf, open }: { panes: ChatPane[]; focused: number | null; ptyOf?: (key: number) => number | undefined; hook?: Record<number, string | undefined>; stateOf?: (key: number) => string | undefined; onPick?: (key: number) => void; taskOf?: (key: number) => string | undefined; open?: ChatOpen }) {
  const [offers, setOffers] = useState<Record<number, Offer & { agent?: string }>>({});
  // A failed support read keeps the last answer: a transient IPC error must not turn a live agent
  // into "this shell has no chat".
  const offersRef = useRef(offers);
  offersRef.current = offers;
  // VIEW-019 (T-050-b): the sessions the user flipped to their terminal, kept while the screen is open.
  const [forced, setForced] = useState<ReadonlySet<number>>(() => new Set());
  const flip = (key: number, on: boolean) =>
    setForced((s) => {
      const next = new Set(s);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const keys = panes.map((p) => p.key).join(",");
  // The pane list is asked about only while the page is showing; shown again it is asked at once.
  const [pageHidden, setPageHidden] = useState(() => typeof document !== "undefined" && document.visibilityState === "hidden");
  useEffect(() => watchHidden(document, setPageHidden), []);
  useEffect(() => {
    const every = pollMs(pageHidden);
    if (every === null) return;
    let alive = true;
    // T-050-c: every pane is asked, a plain shell too, with its terminal: the agent detected in
    // front of it decides (Rust chat_support), and a change in front (`pane-agent`) is asked at once.
    const check = () =>
      Promise.all(panes.map((p) => invoke<Support>("chat_support", { paneKey: p.key, terminal: ptyOf?.(p.key) }).then((s) => [p.key, liveOffer(p.program, p.title, s)] as const).catch(() => [p.key, offersRef.current[p.key] ?? SHELL_OFFER] as const))).then((list) => {
        if (alive) setOffers(Object.fromEntries(list));
      });
    void check();
    const t = setInterval(check, every);
    const front = listen("pane-agent", () => void check()).catch(() => () => {});
    return () => {
      alive = false;
      clearInterval(t);
      void front.then((un) => un());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, pageHidden]);
  const shown = pickChat(panes, focused, offers);
  // VIEW-020: the sessions in the order last viewed, for the hand-off list.
  const [viewed, setViewed] = useState<number[]>([]);
  const shownKey = typeof shown === "object" && shown ? shown.key : null;
  useEffect(() => {
    if (shownKey !== null) setViewed((v) => (v[0] === shownKey ? v : viewedFirst(v, shownKey)));
  }, [shownKey]);
  const view = agentsView(shown, forced);
  // FIX-SOON 1: why a hand-over was refused; it goes when the screen moves to another session.
  const [handNote, setHandNote] = useState<HandNote | null>(null);
  useEffect(() => setHandNote(null), [shownKey]);
  // Shown before the screen's placeholder, which `.chat + .empty` then hides; `.chat.cover` hides
  // the terminal after it (the terminal stays mounted, so flipping back never restarts it).
  if (view === "none" || shown === null) return null;
  if (view === "starting" || shown === "starting")
    return (
      <div className="chat" aria-label="Chat">
        <div className="chat-state" role="status">Starting…</div>
      </div>
    );
  const key = shown.key;
  if (view === "terminal")
    return (
      <div className="chat-switchbar">
        <TerminalSwitch on onFlip={(on) => flip(key, on)} />
      </div>
    );
  // VIEW-020: the result goes into the target's kept draft after what is typed there, then the
  // screen moves to the target, whose box opens with it.
  const hand = makeHand({ panes, key, offers, viewed, taskOf, note: handNote, setNote: setHandNote, onPick, draftOf, keepDraft });
  return <ChatView key={key} pane={shown} agent={offers[key]?.agent} hookState={hook?.[key]} stateOf={stateOf} ptyOf={ptyOf} target={typingInto(focused, shown)} aside={<TerminalSwitch on={false} onFlip={(on) => flip(key, on)} />} hand={hand} open={open} onTerminal={() => flip(key, true)} />;
}

/** VIEW-019: the Show terminal switch: on, the session's raw terminal shows in place of its chat. */
export function TerminalSwitch({ on, onFlip }: { on: boolean; onFlip: (on: boolean) => void }) {
  return (
    <label className="chat-switch">
      <input type="checkbox" role="switch" checked={on} aria-checked={on} onChange={(e) => onFlip(e.currentTarget.checked)} />
      Show terminal
    </label>
  );
}

/** CHAT-028: the files the agent wrote in a finished turn (at most four, newest first), each with a menu to send its path to
 * another agent's draft. Nothing reaches that agent until the user presses Enter there. `note`: why the last send was refused. */
export function FilesRow({ id, files, targets, onSend, note }: { id: string; files: WrittenFile[]; targets: { key: number; label: string }[]; onSend: (to: number, path: string) => void; note: string | null }) {
  const name = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
  return (
    <div className="chat-files" role="group" aria-label="Files the agent wrote" data-row={id}>
      <div className="chat-files-title">Files written</div>
      <ul>
        {files.map((f) => (
          <li key={f.path}>
            <span className="chat-file" title={f.path}>{name(f.path)}</span>
            <span className="chat-file-change">{f.change === "added" ? "new" : f.change === "renamed" ? "renamed" : "edited"}</span>
            {targets.length > 0 && isFullPath(f.path) && <HandOff label="Send to…" what="this file" targets={targets} onPick={(k) => onSend(k, f.path)} />}
          </li>
        ))}
      </ul>
      {note && <div className="chat-hand-note" role="status">{note}</div>}
    </div>
  );
}

/** VIEW-020: Send result to, a short list of other chat sessions (the last viewed first). CHAT-028 reuses it for one file.
 * It closes on a pick, on Escape (focus back on the summary) and on a click anywhere outside it. */
export function HandOff({ targets, onPick, label = "Send result to…", what = "the result" }: { targets: { key: number; label: string }[]; onPick: (key: number) => void; label?: string; what?: string }) {
  const box = useRef<HTMLDetailsElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: Event) => {
      if (outside(box.current, e.target)) box.current?.removeAttribute("open");
    };
    // Capture phase and stopped, so Escape pressed while the menu is open never reaches a terminal or interrupts the agent.
    const offEsc = watchEscape(document, () => {
      box.current?.removeAttribute("open");
      box.current?.querySelector("summary")?.focus();
    });
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      offEsc();
    };
  }, [isOpen]);
  return (
    <details className="chat-hand" ref={box} onToggle={(e) => setIsOpen(e.currentTarget.open)}>
      <summary>{label}</summary>
      <ul aria-label={`Sessions to send ${what} to`}>
        {targets.map((t) => (
          <li key={t.key}>
            <button type="button" onClick={(e) => {
              e.currentTarget.closest("details")?.removeAttribute("open");
              onPick(t.key);
            }}>{t.label}</button>
          </li>
        ))}
      </ul>
    </details>
  );
}
