// Chat panes, slice 1 (docs/research/chat-pane-plan-2026-11-20.md): one pane can be a chat instead of a
// terminal. The pane runs one hidden agent process (an OpenCode session for every model the chat page offers, or `claude`,
// 2026-11-20) through the chat engine, hears every `chat-event`,
// folds it into the rows the chat view already knows (`combine` and `fold`) and draws them with `ViewRow`.
// The box is the same Composer the transcript chat uses, so drafts, attachments, history and the model
// picker behave as they do there. There is no terminal behind this pane; the engine's own events are the
// conversation, and a kept chat opened again reads what was said from the agent's transcript (2026-11-21).
//
// Deliberately not here (the plan's later slices): the pane dot and sidebar row do not move yet because a
// headless process gets no hook events (3), a refusal is a read-only notice rather than an Allow / Deny
// card (4), and nothing under the reply reads the artifacts folder (5).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import AgentMark from "../../marks/AgentMark";
import { productName } from "../../marks/registry";
import { Close, Plus } from "../../chrome/icons";
import { withChord } from "../../terminal/PaneMenu";
import { labelOf } from "../../keys/keymap";
import { useKeymap } from "../../keys/KeymapContext";
import { chatHistory, chatIdOf, endChat, hearChat, sendChat, startChat, stopChat } from "./client";
import { reduce, sessionChange, staleExit, stillWaiting } from "./events";
import { applyRead, combine, livePending, prunePending, type ChatItem, type Pending } from "../model";
import { fold, thoughtIds as idsOf, toggled } from "../steps";
import { Composer, type ComposerHandle } from "../MessageBox";
import { BrowserChoice, LinkContext, type LinkHost } from "../ChatText";
import { printedPaths } from "../chatLinks";
import { nearBottom } from "../composer";
import { loadLabel, visibleRows } from "../page";
import { STOPPING_NOTE } from "../stop";
import { NOTE_MS, selfClearing, sessionTitle, useDismiss } from "../ux";
import { loadSaved, saveChoice } from "../controls";
import { ViewRow, type ChatOpen } from "../ChatView";
import { CHAT_AGENT, DEFAULT_CHAT_MODEL, listChatModels, type ChatModel } from "../opencode";
import { HistoryColumn } from "../webui/HistoryColumn";
import { ModelPopover } from "../webui/ModelPopover";
import { EffortPicker } from "../webui/EffortPicker";
import { Suggestions, Welcome } from "../webui/WelcomeView";
import { columnMode, loadCollapsed, saveCollapsed } from "../webui/history";
import { effortsOf, nameOfId, providerFromId, usableModel } from "../webui/models";
import { useWidth } from "../webui/useWidth";
import { ArtifactsStrip } from "./Strip";
import { changed, mimeOf, newest, POLL_MS, PREVIEW_CAP, readArtifact, scanArtifacts, stampOf, stripIndex, THUMB_CAP, toBlobUrl, type ArtifactRow, type ArtifactScan } from "./artifacts";
import "../chat.css";

/** A Stop that did nothing. The transcript chat's own line tells the user to press Escape in a terminal,
 *  which a chat pane does not have, so this one says only what happened. */
const CANNOT_STOP_NOTE = "Could not stop the agent from here.";

/** The pane's own words when its process has just failed (the empty chat's own "Starting…" is drawn by Welcome). */
const crashedNote = (name: string) => `${name}'s process ended. Your next message starts it again.`;

export default function ChatPane({ pane, hidden = false, focused = false, onFocus, onClose, named = false, onName, model = null, effort = null, resume = null, onSession, onModel, onEffort, open: opener }: {
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
  /** The model this chat starts on; null takes the last pick or the chat's cheap default. */
  model?: string | null;
  /** The effort level this chat starts on; null takes the last pick. */
  effort?: string | null;
  /** Kept so callers still compile. Every chat now runs through OpenCode (CHAT_AGENT), whatever is passed (2026-11-24). */
  agent?: string;
  /** The conversation to pick up (2026-11-21): a kept Everyday chat's own id, so reopening resumes it. */
  resume?: string | null;
  /** The agent's conversation id, once it names one: the window writes it on the chat's kept record. */
  /** The agent conversation the chat is on now; `null` once a handoff ended it. */
  onSession?: (id: string | null) => void;
  /** A model picked in the box (2026-11-21): the window writes it on the chat's kept record, so reopening
   *  resumes on the model the chat last used. */
  onModel?: (model: string | null) => void;
  /** An effort picked in the box, written on the record the same way. */
  onEffort?: (effort: string) => void;
  /** The window's way of opening a link or a printed file, as a terminal pane gets it. */
  open?: ChatOpen;
}) {
  const keymap = useKeymap();
  const chatId = chatIdOf(pane.key);
  /** Every chat runs through OpenCode (2026-11-24); the models behind it are picked at the top of the chat. */
  const agent = CHAT_AGENT;
  /** The AI's name for the pane's own words: "OpenCode", or the id as itself. */
  const name = productName(agent) ?? agent;
  const [items, setItems] = useState<ChatItem[]>([]);
  // CHAT-02: what this pane sent and no echo has confirmed yet, never capped (capPending stays for
  // the transcript chat's own sends).
  const [sent, setSent] = useState<Pending[]>([]);
  const [open, setOpen] = useState(false);
  /** Messages this pane sent that have no result yet (review 2026-11-23): a message queued behind a running
   *  turn gets a result of its own, so the working line and Stop stay until the count is back to 0. */
  const waiting = useRef(0);
  /** The process this pane's chat runs now, as its `started` event named it (review 2026-11-23). */
  const lastPid = useRef<number | null>(null);
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
  // The newest way to report a session id: the listener below outlives one render's props, so it reads the
  // ref instead of closing over a callback that may have been replaced.
  const reportSession = useRef(onSession);
  reportSession.current = onSession;
  // A chat is started once per pane. React's strict mode mounts an effect twice in development; the
  // second mount must not start a second process, or the conversation the first one began is thrown away.
  const started = useRef(false);
  // The session takes its name from the first message, once, unless the user already named the tab.
  const namedOnce = useRef(false);
  // The model and effort this conversation runs at (2026-11-21). A pick in the box restarts the hidden
  // process with `--resume`, so the conversation carries on under the new choice; the window writes both
  // on the chat's kept record, so reopening comes back on the same pair. With nothing picked yet, the
  // last choice wins, and an OpenCode chat with no history starts on the cheap default.
  const savedChoice = useMemo(() => loadSaved()[agent], [agent]);
  const choice = useRef<{ model: string; effort: string | null }>({
    // An older chat may hold a Claude-era name like "opus"; only an OpenCode id (route/maker/model) is used.
    model: usableModel(model) ?? usableModel(savedChoice?.model) ?? DEFAULT_CHAT_MODEL,
    effort: effort ?? savedChoice?.effort ?? null,
  });
  const sessionId = useRef<string | null>(resume);
  /** The chat open now, for the history column's highlight (the ref above is what the listener reads). */
  const [activeSession, setActiveSession] = useState<string | null>(resume);
  const [liveModel, setLiveModel] = useState(choice.current.model);
  const [liveEffort, setLiveEffort] = useState(choice.current.effort);
  // The Open WebUI screen (2026-11-24): the model list for the top picker, the history column and its width.
  const [models, setModels] = useState<ChatModel[]>([]);
  const [collapsed, setCollapsed] = useState(() => loadCollapsed());
  const [screen, width] = useWidth<HTMLDivElement>();
  const mode = columnMode(width, collapsed);
  const [historyTick, setHistoryTick] = useState(0);
  const composer = useRef<ComposerHandle>(null);
  useEffect(() => {
    let live = true;
    void listChatModels().then((list) => live && setModels(list), () => {});
    return () => {
      live = false;
    };
  }, []);
  const setSession = (id: string | null) => {
    sessionId.current = id;
    setActiveSession(id);
    setHistoryTick((n) => n + 1);
  };
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
          if (ev.kind === "started" && ev.pid !== undefined) lastPid.current = ev.pid;
          // A late exit of a process already replaced says nothing about the one running now.
          if (staleExit(ev, lastPid.current)) return;
          seq.current += 1;
          const now = Date.now();
          setItems((prev) => reduce(prev, ev, now, seq.current));
          // The working line and the Stop button follow the turn, which only the turn's own end closes, and
          // stay while a message queued behind it still runs.
          waiting.current = stillWaiting(waiting.current, ev);
          if (ev.kind === "result" || ev.kind === "stopped") setOpen(waiting.current > 0);
          // A reply while nothing was waiting is a turn the page did not count: it runs until its result.
          if (ev.kind === "assistant" && waiting.current > 0) setOpen(true);
          // A kept Everyday chat learns the agent's own conversation id here: the init line names it, and a
          // resumed process (after a crash or a sleep) names the one it picked up (`Started.resumed`).
          // A handoff (2026-11-23) ends that conversation: the id is forgotten here and in the kept record, so
          // a model or effort pick, or opening the chat again, starts fresh instead of resuming the full one.
          const session = sessionChange(ev);
          if (session !== undefined) {
            setSession(session);
            reportSession.current?.(session);
          }
          // A finished turn is when most artifacts appear, so the folder is read again right then, and the
          // history column's list has a new or retitled chat.
          if (ev.kind === "result") {
            setLookAt((n) => n + 1);
            setHistoryTick((n) => n + 1);
          }
          if (ev.kind === "exit") {
            setOpen(waiting.current > 0);
            if (ev.reason === "crashed") setNote(crashedNote(productName(agent) ?? agent));
          }
        });
        if (!live) return off();
        unheard = off;
        if (!started.current) {
          started.current = true;
          // A kept chat opened again (2026-11-21): the agent's own transcript holds what was said, and a
          // resumed process does not say it again. A session whose file is gone is not resumed at all: the
          // agent would only answer "no conversation found", so the chat starts fresh and says so quietly.
          let pick = sessionId.current;
          if (pick && pick === resume) {
            const history = await chatHistory(agent, cwd, pick).catch(() => null);
            if (!live) {
              // The effect was re-run or closed while the history loaded. A re-run saw `started` and
              // skipped, so give the start back and ask for another run, or the chat has no process.
              started.current = false;
              setAgain((n) => n + 1);
              return;
            }
            if (history) setItems(applyRead([], history));
            else {
              // The saved conversation is gone: forget its id here too, so a later model or effort pick
              // cannot restart the process with `--resume <gone-id>`.
              setSession(null);
              pick = null;
            }
          }
          await startChat(chatId, cwd, choice.current.model, agent, pick, choice.current.effort);
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
    // The model and effort props are the first pair only; a later pick is applied by `applyChoice` below,
    // which restarts the process itself. Re-running this effect on a prop change would start a second
    // process or skip the restart while the previous cleanup is still pending.
  }, [chatId, pane.cwd, agent, again]);

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
    waiting.current = 0;
    lastPid.current = null;
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

  // CHAT-02 review (P2): as the transcript grows, a send it now confirms is forgotten once, so the memo
  // below only scans the sends still waiting rather than every send this pane ever made. A change with
  // nothing confirmed gives back the same array, so it costs no redraw.
  useEffect(() => {
    setSent((xs) => prunePending(xs, items));
  }, [items]);
  const pending = useMemo(() => livePending(sent, items), [sent, items]);
  const rows = useMemo(() => combine(items, [], null, pending), [items, pending]);
  const shown = useMemo(() => visibleRows(rows, pages), [rows, pages]);
  const views = useMemo(() => fold(shown, open, pane.cwd), [shown, open, pane.cwd]);
  // T-965: under the last finished turn, above one that is still running.
  const stripAt = stripIndex(views);
  const earlier = loadLabel(rows.length, pages, 0);
  const thoughtIds = idsOf(items);
  const toggle = (id: string) => setThoughts((t) => toggled(t, id));
  // CHAT-024: the model the agent reported last, named beside the box. Claude reports the change it made
  // OpenCode's pick restarts the process, so the choice this pane keeps is the truth.
  const shownModel = liveModel;
  const modelName = models.find((m) => m.id === liveModel)?.label ?? nameOfId(liveModel);
  const efforts = effortsOf(models, liveModel);
  const empty = rows.length === 0 && !error;

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

  // A model or effort pick in the box (2026-11-21): the hidden process has no live switch in print mode,
  // so it is ended and started again with `--resume` on the conversation's own id. The rows stay on
  // screen; only the process behind them changes. The box disables these picks while a turn runs, so
  // nothing is cut off mid-answer.
  const applyChoice = (pick: { model?: string; effort?: string | null }) => {
    const next = {
      model: pick.model === undefined ? choice.current.model : pick.model,
      effort: pick.effort === undefined ? choice.current.effort : pick.effort,
    };
    choice.current = next;
    setLiveModel(next.model);
    setLiveEffort(next.effort);
    if (pick.model !== undefined) onModel?.(next.model);
    if (pick.effort) onEffort?.(pick.effort);
    const cwd = pane.cwd;
    if (!cwd || open || waiting.current > 0) return;
    void (async () => {
      try {
        // `chat_start` closes the chat's old process itself (Engines::start), so no separate end here.
        // Only the id this pane holds is resumed: a conversation found gone was cleared from it.
        await startChat(chatId, cwd, next.model, agent, sessionId.current, next.effort);
        setSpawned(true);
      } catch (e) {
        setError(String(e));
      }
    })();
  };

  /** The top picker: the model changes for the next turn on the same conversation. An effort the new model
   *  does not offer is dropped, so the box never shows a level the model cannot run at. */
  const pickModel = (id: string) => {
    const offered = effortsOf(models, id);
    const keep = choice.current.effort && offered.includes(choice.current.effort) ? choice.current.effort : null;
    saveChoice(agent, { model: id, ...(keep ? { effort: keep } : {}) });
    applyChoice({ model: id, effort: keep });
  };
  const pickEffort = (level: string) => {
    saveChoice(agent, { effort: level });
    applyChoice({ effort: level });
  };

  /** Wipes what is on screen for another conversation: the rows, the sends still waiting and the scroll. */
  const resetView = () => {
    setItems([]);
    setSent([]);
    setPages(0);
    setThoughts(new Set());
    setNote(null);
    setOpen(false);
    setAway(false);
    waiting.current = 0;
    stick.current = true;
  };
  const BUSY_NOTE = "Wait for the reply to finish, or press Stop, before switching chats.";

  /** New chat: a fresh conversation in the same folder. */
  const newChat = (force = false) => {
    const cwd = pane.cwd;
    if (!cwd) return;
    if (!force && (open || waiting.current > 0)) return setNote(BUSY_NOTE);
    if (!force && rows.length === 0 && sessionId.current === null) return composer.current?.focus();
    resetView();
    namedOnce.current = false;
    setSession(null);
    reportSession.current?.(null);
    void startChat(chatId, cwd, choice.current.model, agent, null, choice.current.effort).then(
      () => (setSpawned(true), composer.current?.focus()),
      (e) => setError(String(e)),
    );
  };

  /** A past chat from the history column: its transcript is read back and the process resumes on it. */
  const openSession = (id: string) => {
    const cwd = pane.cwd;
    if (!cwd || id === sessionId.current) return;
    if (open || waiting.current > 0) return setNote(BUSY_NOTE);
    void (async () => {
      try {
        const history = await chatHistory(agent, cwd, id);
        resetView();
        namedOnce.current = true;
        setItems(applyRead([], history));
        setSession(id);
        reportSession.current?.(id);
        await startChat(chatId, cwd, choice.current.model, agent, id, choice.current.effort);
        setSpawned(true);
      } catch (e) {
        setNote(`Could not open that chat. ${String(e)}`);
      }
    })();
  };

  /** The box clears its text at once: a send that fails later marks its waiting row failed and says why
   *  under the box, so nothing typed is silently swallowed and nothing is held back on a guess. */
  const send = (text: string): boolean => {
    if (!namedOnce.current) {
      namedOnce.current = true;
      const name = named ? null : sessionTitle(text);
      if (name) onName?.(name);
    }
    const id = `sent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    // A send typed while an earlier send has no result yet is queued behind that turn: its rows keep
    // streaming after it, so the row waits at the tail. With nothing waiting, the next reply is this
    // send's own, so it sits above it (the finished turn before it leaves no turn under way).
    const queued = waiting.current > 0;
    setSent((xs) => [...xs, { id, text, at: Date.now(), queued }]);
    setNote(null);
    waiting.current += 1;
    setOpen(true);
    stick.current = true;
    void sendChat(chatId, text).then(undefined, (e) => {
      waiting.current = Math.max(0, waiting.current - 1);
      setOpen(waiting.current > 0);
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

  const title = pane.title || name;
  return (
    <LinkContext.Provider value={host}>
      <section className={`pane chat-pane${focused ? " focused" : ""}`} hidden={hidden} aria-label={`${title} chat`} onMouseDown={onFocus} data-kind="chat" data-key={pane.key}>
        <header className="pane-head">
          <span className="agent-mark" title={name}>
            <AgentMark id={agent} size={13} label={name} />
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
        <div className="wui-screen" ref={screen}>
        <HistoryColumn
          cwd={pane.cwd}
          mode={mode}
          activeId={activeSession}
          refreshKey={historyTick}
          onNew={() => newChat()}
          onOpen={openSession}
          onDeleted={(id) => id === sessionId.current && newChat(true)}
          onToggle={() => setCollapsed((c) => (saveCollapsed(!c), !c))}
        />
        <div className="chat cover chat-surface wui-chat" aria-label="Chat" data-empty={empty ? "true" : undefined}>
          <div className="wui-bar">
            {mode === "hidden" && (
              <button type="button" className="wui-icon" aria-label="New chat" title="New chat" onClick={() => newChat()}>
                <Plus size={16} />
              </button>
            )}
            <ModelPopover models={models} value={liveModel} disabled={open} onPick={pickModel} />
          </div>
          {error ? (
            <div className="chat-state chat-error" role="alert">
              {error}{" "}
              <button type="button" className="chat-link-btn" onClick={() => (setError(null), setAgain((n) => n + 1))}>
                Try again
              </button>
            </div>
          ) : rows.length === 0 ? (
            <div className="chat-welcome">
              <Welcome label={modelName} provider={providerFromId(liveModel)} starting={!spawned} />
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
          {/* The box keeps one place in the tree whether the chat is empty or not, so a draft and the files
              attached survive the first send; only the page's CSS moves it from the middle to the bottom. */}
          <Composer
            ref={composer}
            paneKey={pane.key}
            live={!error}
            note={note ?? undefined}
            onSend={send}
            working={open}
            onStop={stop}
            agent={agent}
            cwd={pane.cwd}
            shownModel={shownModel}
            tools={<EffortPicker efforts={efforts} value={liveEffort} disabled={open} onPick={pickEffort} />}
          />
          {empty && spawned ? <Suggestions onFill={(text) => composer.current?.fill(text)} /> : null}
          {full && (
            <button type="button" className="chat-full" aria-label="Close image" onClick={closeFull}>
              <img src={full} alt="Attached" />
            </button>
          )}
        </div>
        </div>
      </section>
    </LinkContext.Provider>
  );
}
