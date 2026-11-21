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
import { NOTE_MS, selfClearing, sessionTitle, useDismiss } from "../ux";
import { readModel } from "../controls";
import { ViewRow, type ChatOpen } from "../ChatView";
import { ArtifactsStrip } from "./Strip";
import { changed, mimeOf, newest, POLL_MS, PREVIEW_CAP, readArtifact, scanArtifacts, stampOf, stripIndex, THUMB_CAP, toBlobUrl, type ArtifactRow, type ArtifactScan } from "./artifacts";
import "../chat.css";

/** A Stop that did nothing. The transcript chat's own line tells the user to press Escape in a terminal,
 *  which a chat pane does not have, so this one says only what happened. */
const CANNOT_STOP_NOTE = "Could not stop the agent from here.";

/** The pane's own words while its process is being started or has just failed. */
const STARTING_NOTE = "Starting Claude…";
const CRASHED_NOTE = "Claude's process ended. Your next message starts it again.";

export default function ChatPane({ pane, hidden = false, focused = false, onFocus, onClose, named = false, onName, model = null, open: opener }: {
  pane: { key: number; cwd: string | null; title?: string };
  /** True while the grid hides this pane: it reads nothing new either way, the event stream pushes. */
  hidden?: boolean;
  focused?: boolean;
  onFocus: () => void;
  onClose: () => void;
  /** The pane already has a name the user gave it, so the first message must not replace it. */
  named?: boolean;
  /** Names the session after its first message, as a chat app does, once per pane. */
  onName?: (name: string) => void;
  /** The Claude model this chat starts on (the Everyday New session menu); null keeps the program's own default. */
  model?: string | null;
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
  // The session takes its name from the first message, once, unless the user already named the tab.
  const namedOnce = useRef(false);
  const ending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false);
  // T-965: the artifacts folder under this chat. The scan is the source of truth; the stamps say a file
  // changed, so only that file is read again; the blob URLs are kept here so they can be revoked when the
  // file changes or the pane goes away.
  const [arts, setArts] = useState<ArtifactScan>({ rows: [], skipped: [] });
  const [thumbs, setThumbs] = useState<Map<string, string>>(() => new Map());
  const [looked, setLooked] = useState(Date.now());
  const [lookAt, setLookAt] = useState(0);
  const stamps = useRef(new Map<string, string>());
  const blobs = useRef(new Map<string, string>());
  const big = useRef<string | null>(null);

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
          // A finished turn is when most artifacts appear, so the folder is read again right then.
          if (ev.kind === "result") setLookAt((n) => n + 1);
          if (ev.kind === "exit") {
            setOpen(false);
            if (ev.reason === "crashed") setNote(CRASHED_NOTE);
          }
        });
        if (!live) return off();
        unheard = off;
        if (!started.current) {
          started.current = true;
          await startChat(chatId, cwd, model);
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
  }, [chatId, pane.cwd, model, again]);

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
    setAway(false);
  }, [chatId]);

  // T-965: the artifacts folder, read when the pane shows, when a turn ends and every three seconds
  // while it is on screen. A hidden pane reads nothing; the plan reuses this rule from reading.ts.
  useEffect(() => {
    const cwd = pane.cwd;
    if (hidden || !cwd) return;
    let live = true;
    // A scan every three seconds must not re-render the strip when no picture changed.
    const sync = () =>
      setThumbs((prev) => (prev.size === blobs.current.size && [...prev].every(([path, url]) => blobs.current.get(path) === url) ? prev : new Map(blobs.current)));
    const look = async () => {
      let scan: ArtifactScan;
      try {
        scan = await scanArtifacts(cwd);
      } catch {
        return; // no folder is no artifacts; the chat itself says nothing about it
      }
      if (!live) return;
      const shown = newest(scan.rows);
      setArts({ rows: shown, skipped: scan.skipped });
      setLooked(Date.now());
      // A file that left the strip takes its bytes with it: revoke, forget, never show a stale picture.
      for (const [path, url] of blobs.current) {
        if (shown.some((r) => r.path === path)) continue;
        URL.revokeObjectURL(url);
        blobs.current.delete(path);
        stamps.current.delete(path);
      }
      sync();
      // Only the pictures whose stamp moved are read again. A page or a video is only ever a card.
      for (const row of changed(stamps.current, shown)) {
        stamps.current.set(row.path, stampOf(row));
        if (row.kind !== "image") continue;
        try {
          const b64 = await readArtifact(cwd, row.path, THUMB_CAP);
          if (!live) return;
          const url = toBlobUrl(b64, mimeOf(row));
          const old = blobs.current.get(row.path);
          if (old) URL.revokeObjectURL(old);
          blobs.current.set(row.path, url);
          sync();
        } catch {
          // A picture that cannot be read keeps its kind word instead of a broken image.
        }
      }
    };
    void look();
    const t = setInterval(() => void look(), POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [hidden, pane.cwd, lookAt]);

  // The pane's blob URLs live as long as the window unless they are revoked; a closed pane gives them back.
  useEffect(
    () => () => {
      for (const url of blobs.current.values()) URL.revokeObjectURL(url);
      blobs.current.clear();
      if (big.current) URL.revokeObjectURL(big.current);
      big.current = null;
    },
    [],
  );

  const pending = useMemo(() => capPending(sent), [sent]);
  const rows = useMemo(() => combine(items, [], null, pending), [items, pending]);
  const shown = useMemo(() => visibleRows(rows, pages), [rows, pages]);
  const views = useMemo(() => fold(shown, open, pane.cwd), [shown, open, pane.cwd]);
  // T-965: under the last finished turn, above one that is still running.
  const stripAt = stripIndex(views);
  const earlier = loadLabel(rows.length, pages, 0);
  const thoughtIds = idsOf(items);
  const toggle = (id: string) => setThoughts((t) => toggled(t, id));
  // CHAT-024: the model the agent reported last, named beside the box (the picker sends Claude's own
  // `/model` line, so a chat keeps it across turns as the terminal chat does).
  const shownModel = useMemo(() => readModel("claude", items) ?? model, [items, model]);

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
  /** The large picture is a blob too; closing it gives the bytes back. */
  const closeFull = () => {
    if (big.current) URL.revokeObjectURL(big.current);
    big.current = null;
    setFull(null);
  };
  useDismiss(full !== null, closeFull, ".chat-full");

  /** A picture large, inside the pane: read at the full preview limit, never at the thumbnail's. */
  const preview = (row: ArtifactRow) => {
    const cwd = pane.cwd;
    if (!cwd) return;
    void readArtifact(cwd, row.path, PREVIEW_CAP).then((b64) => {
      if (big.current) URL.revokeObjectURL(big.current);
      big.current = toBlobUrl(b64, mimeOf(row));
      setFull(big.current);
    }, (e) => setNote(String(e)));
  };
  /** A page or a video: the real file, in the program the user has for it. */
  const openOnDisk = (row: ArtifactRow) => void invoke("open_path", { path: row.path }).catch((e) => setNote(String(e)));

  /** The box clears its text at once: a send that fails later marks its waiting row failed and says why
   *  under the box, so nothing typed is silently swallowed and nothing is held back on a guess. */
  const send = (text: string): boolean => {
    if (!namedOnce.current) {
      namedOnce.current = true;
      const name = named ? null : sessionTitle(text);
      if (name) onName?.(name);
    }
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
            at 45% when it shares a screen with a terminal. `chat-surface` is the app-like page: the pane
            is the page, so there is no inner card, no bar and one centred reading column. */}
        <div className="chat cover chat-surface" aria-label="Chat">
          {error ? (
            <div className="chat-state chat-error" role="alert">
              {error}{" "}
              <button type="button" className="chat-link-btn" onClick={() => (setError(null), setAgain((n) => n + 1))}>
                Try again
              </button>
            </div>
          ) : rows.length === 0 ? (
            <div className="chat-welcome">
              <span className="chat-welcome-mark" aria-hidden="true">
                <VendorMark agent="claude" size={30} />
              </span>
              <h2 className="chat-welcome-title">{spawned ? "What should we work on?" : STARTING_NOTE}</h2>
              {spawned && (
                <>
                  <p className="chat-welcome-line">Ask in plain words. Claude works in this folder and shows you what it changes.</p>
                  <div className="chat-starters" role="group" aria-label="Things to try">
                    <button type="button" onClick={() => send("Explain what this project does, in plain words.")}>
                      Explain this project
                    </button>
                    <button type="button" onClick={() => send("Look through this project and find the most likely bug. Tell me what you find before changing anything.")}>
                      Find a bug
                    </button>
                    <button type="button" onClick={() => send("Suggest one improvement to this project and explain why it matters.")}>
                      Suggest an improvement
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}
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
          {rows.length > 0 && (
            <div className="chat-list" ref={list} onScroll={onScroll}>
              {earlier && (
                <button type="button" className="chat-load-earlier" onClick={() => setPages((p) => p + 1)}>
                  {earlier}
                </button>
              )}
              {views.slice(0, stripAt).map((v) => (
                <ViewRow key={`${v.row}-${v.id}`} view={v} onImage={setFull} thoughts={thoughts} onToggle={toggle} />
              ))}
              <ArtifactsStrip rows={arts.rows} skipped={arts.skipped} thumbs={thumbs} now={looked} onOpen={openOnDisk} onPreview={preview} />
              {views.slice(stripAt).map((v) => (
                <ViewRow key={`${v.row}-${v.id}`} view={v} onImage={setFull} thoughts={thoughts} onToggle={toggle} />
              ))}
            </div>
          )}
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
            <button type="button" className="chat-full" aria-label="Close image" onClick={closeFull}>
              <img src={full} alt="Attached" />
            </button>
          )}
        </div>
      </section>
    </LinkContext.Provider>
  );
}
