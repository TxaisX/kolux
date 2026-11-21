// Chat panes, slice 1 (docs/research/chat-pane-plan-2026-11-20.md): one pane can be a chat instead of a
// terminal. The pane runs one hidden `claude` process through the chat engine, hears every `chat-event`,
// folds it into the rows the chat view already knows (`combine` and `fold`) and draws them with `ViewRow`.
// The box is the same Composer the transcript chat uses, so drafts, attachments, history and the model
// picker behave as they do there. There is no terminal behind this pane and no transcript file: the
// engine's own events are the conversation.
//
// Deliberately not here (the plan's later slices): the conversation does not survive a restart (2), the
// pane dot and sidebar row do not move yet because a headless process gets no hook events (3), a refusal
// is a read-only notice rather than an Allow / Deny card (4), and nothing under the reply reads the
// artifacts folder (5).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import VendorMark from "../../chrome/VendorMark";
import { Close } from "../../chrome/icons";
import { withChord } from "../../terminal/PaneMenu";
import { labelOf } from "../../keys/keymap";
import { useKeymap } from "../../keys/KeymapContext";
import { chatIdOf, endChat, hearChat, sendChat, startChat, stopChat } from "./client";
import { reduce } from "./events";
import { capPending, combine, type ChatItem, type Pending } from "../model";
import { fold, thoughtIds as idsOf, toggled } from "../steps";
import { Composer } from "../MessageBox";
import { BrowserChoice, LinkContext, type LinkHost } from "../ChatText";
import { printedPaths } from "../chatLinks";
import { nearBottom } from "../composer";
import { loadLabel, visibleRows } from "../page";
import { STOPPING_NOTE } from "../stop";
import { NOTE_MS, selfClearing, useDismiss } from "../ux";
import { readModel } from "../controls";
import { ViewRow, type ChatOpen } from "../ChatView";
import "../chat.css";

/** A Stop that did nothing. The transcript chat's own line tells the user to press Escape in a terminal,
 *  which a chat pane does not have, so this one says only what happened. */
const CANNOT_STOP_NOTE = "Could not stop the agent from here.";

/** The pane's own words while its process is being started or has just failed. */
const STARTING_NOTE = "Starting Claude…";
const CRASHED_NOTE = "Claude's process ended. Your next message starts it again.";

export default function ChatPane({ pane, hidden = false, focused = false, onFocus, onClose, open: opener }: {
  pane: { key: number; cwd: string | null; title?: string };
  /** True while the grid hides this pane: it reads nothing new either way, the event stream pushes. */
  hidden?: boolean;
  focused?: boolean;
  onFocus: () => void;
  onClose: () => void;
  /** The window's way of opening a link or a printed file, as a terminal pane gets it. */
  open?: ChatOpen;
}) {
  const keymap = useKeymap();
  const chatId = chatIdOf(pane.key);
  const [items, setItems] = useState<ChatItem[]>([]);
  // CHAT-020: what this pane sent and the agent has not echoed yet (at most 8).
  const [sent, setSent] = useState<Pending[]>([]);
  const [open, setOpen] = useState(false);
  /** The process is up (the engine answered `chat_start`), so the empty line stops saying it is starting. */
  const [spawned, setSpawned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [full, setFull] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ url: string; at: { x: number; y: number } } | null>(null);
  const [pages, setPages] = useState(0);
  const [again, setAgain] = useState(0);
  // CHAT-026: Thought rows start folded; the toolbar opens or folds them all.
  const [thoughts, setThoughts] = useState<Set<string>>(() => new Set());
  const seq = useRef(0);
  // A chat is started once per pane. React's strict mode mounts an effect twice in development; the
  // second mount must not start a second process, or the conversation the first one began is thrown away.
  const started = useRef(false);
  const ending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false);

  useEffect(() => {
    // The pane is being drawn again in the same tick (strict mode): keep the process the first mount
    // started. Only a real close lets the end below run.
    if (ending.current !== null) {
      clearTimeout(ending.current);
      ending.current = null;
    }
    const cwd = pane.cwd;
    if (!cwd) {
      setError("This pane has no folder, so a chat cannot start in it.");
      return;
    }
    let live = true;
    let unheard: (() => void) | null = null;
    void (async () => {
      try {
        const off = await hearChat(chatId, (ev) => {
          if (!live) return;
          seq.current += 1;
          const now = Date.now();
          setItems((prev) => reduce(prev, ev, now, seq.current));
          // The working line and the Stop button follow the turn, which only the turn's own end closes.
          if (ev.kind === "result" || ev.kind === "stopped") setOpen(false);
          if (ev.kind === "exit") {
            setOpen(false);
            if (ev.reason === "crashed") setNote(CRASHED_NOTE);
          }
        });
        if (!live) return off();
        unheard = off;
        if (!started.current) {
          started.current = true;
          await startChat(chatId, cwd);
          if (live) setSpawned(true);
        }
      } catch (e) {
        if (!live) return;
        started.current = false;
        setError(String(e));
      }
    })();
    return () => {
      live = false;
      unheard?.();
      // Ending the process now would also end it for a mount that is about to draw this pane again, so the
      // end waits one tick; the effect above cancels it when it runs, and a closed pane lets it through.
      ending.current = setTimeout(() => {
        ending.current = null;
        started.current = false;
        void endChat(chatId).catch(() => {});
      }, 0);
    };
  }, [chatId, pane.cwd, again]);

  // The box's own note clears itself, except the stopping line, which goes when the turn ends.
  useEffect(() => {
    if (!selfClearing(note, STOPPING_NOTE)) return;
    const t = setTimeout(() => setNote((n) => (n === note ? null : n)), NOTE_MS);
    return () => clearTimeout(t);
  }, [note]);
  useEffect(() => {
    if (!open) setNote((n) => (n === STOPPING_NOTE ? null : n));
  }, [open]);
  // A new chat is a new conversation with its own scroll and drafts.
  useEffect(() => {
    setItems([]);
    setSent([]);
    setPages(0);
    setOpen(false);
  }, [chatId]);

  const pending = useMemo(() => capPending(sent), [sent]);
  const rows = useMemo(() => combine(items, [], null, pending), [items, pending]);
  const shown = useMemo(() => visibleRows(rows, pages), [rows, pages]);
  const views = useMemo(() => fold(shown, open, pane.cwd), [shown, open, pane.cwd]);
  const earlier = loadLabel(rows.length, pages, 0);
  const thoughtIds = idsOf(items);
  const toggle = (id: string) => setThoughts((t) => toggled(t, id));
  // CHAT-024: the model the agent reported last, named beside the box (the picker sends Claude's own
  // `/model` line, so a chat keeps it across turns as the terminal chat does).
  const shownModel = useMemo(() => readModel("claude", items), [items]);

  // CHAT-025: a link in a reply opens as it does in a terminal pane. Files are only openable when the
  // agent printed them recently (chatLinks.ts); with no in-app viewer every web link asks first.
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
  const pickBrowser = (where: "kolux" | "system"): boolean => {
    if (!menu) return false;
    const inApp = where === "kolux" && !!opener?.onOpenLink;
    if (inApp) opener!.onOpenLink!(menu.url);
    else void invoke("open_external", { url: menu.url }).catch((e) => setNote(String(e)));
    setMenu(null);
    return inApp;
  };

  // CHAT-027: within 48 px of the bottom the view follows new output; further up it holds still.
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
  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [views]);
  useDismiss(full !== null, () => setFull(null), ".chat-full");

  /** The box clears its text at once: a send that fails later marks its waiting row failed and says why
   *  under the box, so nothing typed is silently swallowed and nothing is held back on a guess. */
  const send = (text: string): boolean => {
    const id = `sent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setSent((xs) => capPending([...xs, { id, text, at: Date.now() }]));
    setNote(null);
    setOpen(true);
    stick.current = true;
    void sendChat(chatId, text).then(undefined, (e) => {
      setOpen(false);
      setSent((xs) => xs.map((x) => (x.id === id ? { ...x, failed: true } : x)));
      setNote(String(e));
    });
    return true;
  };
  // CHAT-018: Stop, which ends the turn through the engine and not through a keyboard.
  const stop = () => {
    setNote(STOPPING_NOTE);
    void stopChat(chatId).then(
      (how) => {
        if (how === null) setNote(CANNOT_STOP_NOTE);
      },
      () => setNote(CANNOT_STOP_NOTE),
    );
  };

  const title = pane.title || "Claude";
  return (
    <LinkContext.Provider value={host}>
      <section className={`pane chat-pane${focused ? " focused" : ""}`} hidden={hidden} aria-label={`${title} chat`} onMouseDown={onFocus} data-kind="chat" data-key={pane.key}>
        <header className="pane-head">
          <span className="agent-mark" title="Claude">
            <VendorMark agent="claude" size={13} />
          </span>
          <span className="title" title={pane.cwd ?? undefined}>
            {title}
          </span>
          <span className="preview-tag">Chat</span>
          <span className="right">
            <button className="ib" onClick={onClose} title={withChord("Close tab", labelOf(keymap, "tab.close"))} aria-label="Close the chat">
              <Close size={12} />
            </button>
          </span>
        </header>
        {/* `cover` is what the transcript chat uses when it takes the whole frame: .chat is only capped
            at 45% when it shares a screen with a terminal. */}
        <div className="chat cover" aria-label="Chat">
          {error ? (
            <div className="chat-state chat-error" role="alert">
              {error}{" "}
              <button type="button" className="chat-link-btn" onClick={() => (setError(null), setAgain((n) => n + 1))}>
                Try again
              </button>
            </div>
          ) : (
            rows.length === 0 && <div className="chat-state">{spawned ? "No messages yet. What you type below and what Claude answers shows up here." : STARTING_NOTE}</div>
          )}
          {thoughtIds.length > 0 && (
            <div className="chat-toolbar">
              <button type="button" onClick={() => setThoughts(new Set(thoughtIds))}>
                Expand thoughts
              </button>
              <button type="button" onClick={() => setThoughts(new Set())}>
                Collapse thoughts
              </button>
            </div>
          )}
          <div className="chat-list" ref={list} onScroll={onScroll}>
            {earlier && (
              <button type="button" className="chat-load-earlier" onClick={() => setPages((p) => p + 1)}>
                {earlier}
              </button>
            )}
            {views.map((v) => (
              <ViewRow key={`${v.row}-${v.id}`} view={v} onImage={setFull} thoughts={thoughts} onToggle={toggle} />
            ))}
          </div>
          {away && (
            <button type="button" className="chat-jump" onClick={toBottom}>
              Jump to latest
            </button>
          )}
          {menu && <BrowserChoice url={menu.url} at={menu.at} onPick={pickBrowser} onClose={() => setMenu(null)} />}
          <Composer
            paneKey={pane.key}
            live={!error}
            note={note ?? undefined}
            onSend={send}
            working={open}
            onStop={stop}
            agent="claude"
            cwd={pane.cwd}
            shownModel={shownModel}
          />
          {full && (
            <button type="button" className="chat-full" aria-label="Close image" onClick={() => setFull(null)}>
              <img src={full} alt="Attached" />
            </button>
          )}
        </div>
      </section>
    </LinkContext.Provider>
  );
}
