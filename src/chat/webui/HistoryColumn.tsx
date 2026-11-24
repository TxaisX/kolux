// The chat history column (2026-11-24, the Open WebUI screen): New chat, a search over titles and the past
// chats of this folder grouped by day. `HistoryView` only draws what it is given; `HistoryColumn` loads the
// list from OpenCode and holds the search, the "..." menu and the delete question.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dots, PanelLeft, Plus, Search, Trash } from "../../chrome/icons";
import { CHAT_AGENT, deleteChatSession, listChatSessions, type ChatSessionSummary } from "../opencode";
import { chatHistory } from "../live/client";
import { onSessionDeleted } from "../live/sessionBus";
import { filterSessions, groupSessions, isBlankTitle, titleOf, visibleSessions, type ColumnMode } from "./history";

export type HistoryViewProps = {
  mode: ColumnMode;
  sessions: readonly ChatSessionSummary[];
  now: number;
  activeId: string | null;
  query: string;
  /** The chat a Delete question is open for. */
  asking: string | null;
  /** The chat whose "..." menu is open. */
  menu?: string | null;
  onQuery: (q: string) => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onMenu?: (id: string | null) => void;
  onAskDelete: (id: string) => void;
  onCancelDelete: () => void;
  onDelete: (id: string) => void;
  onToggle: () => void;
  /** Drawn in place of the list when it is empty. */
  emptyNote?: string;
};

/** Memoised: the pane redraws on every streamed word, and this list (hundreds of rows) must not. */
export const HistoryView = memo(function HistoryView({ mode, sessions, now, activeId, query, asking, menu = null, onQuery, onNew, onOpen, onMenu, onAskDelete, onCancelDelete, onDelete, onToggle, emptyNote }: HistoryViewProps) {
  // Grouped only when the list, the search or the clock moved; hooks run before the early returns below.
  const groups = useMemo(() => (mode === "full" ? groupSessions(filterSessions(sessions, query), now) : []), [mode, sessions, query, now]);
  if (mode === "hidden") return null;
  if (mode === "rail") {
    return (
      <nav className="wui-history rail" aria-label="Chat history">
        <button type="button" className="wui-icon" aria-label="Show chat list" title="Show chat list" onClick={onToggle}>
          <PanelLeft size={16} />
        </button>
        <button type="button" className="wui-icon" aria-label="New chat" title="New chat" onClick={onNew}>
          <Plus size={16} />
        </button>
        <button type="button" className="wui-icon" aria-label="Search chats" title="Search chats" onClick={onToggle}>
          <Search size={16} />
        </button>
      </nav>
    );
  }
  return (
    <nav className="wui-history" aria-label="Chat history">
      <div className="wui-top">
        <button type="button" className="wui-new" onClick={onNew}>
          <Plus size={15} />
          <span>New chat</span>
        </button>
        <button type="button" className="wui-icon" aria-label="Hide chat list" title="Hide chat list" onClick={onToggle}>
          <PanelLeft size={16} />
        </button>
      </div>
      <label className="wui-search">
        <Search size={14} />
        <input type="search" aria-label="Search chats" placeholder="Search" value={query} onChange={(e) => onQuery(e.currentTarget.value)} />
      </label>
      <div className="wui-list">
        {groups.length === 0 && <p className="wui-empty">{emptyNote ?? (query.trim() ? "No chats match." : "Your past chats show up here.")}</p>}
        {groups.map((g) => (
          <section key={g.label} aria-label={g.label}>
            <h3 className="wui-group">{g.label}</h3>
            <ul>
              {g.sessions.map((s) => {
                const active = s.id === activeId;
                return (
                  <li key={s.id} className={`wui-item${active ? " active" : ""}`}>
                    {asking === s.id ? (
                      <div className="wui-ask" role="group" aria-label={`Delete ${s.title}?`}>
                        <span>Delete this chat?</span>
                        <button type="button" className="wui-danger" aria-label={`Delete ${s.title}`} onClick={() => onDelete(s.id)}>
                          Delete
                        </button>
                        <button type="button" onClick={onCancelDelete}>
                          Keep
                        </button>
                      </div>
                    ) : (
                      <>
                        <button type="button" className="wui-row" aria-current={active ? "true" : undefined} onClick={() => onOpen(s.id)}>
                          <span className="wui-title">{s.title}</span>
                        </button>
                        <button type="button" className="wui-more" aria-label={`Options for ${s.title}`} aria-haspopup="menu" aria-expanded={menu === s.id} onClick={() => onMenu?.(menu === s.id ? null : s.id)}>
                          <Dots size={14} />
                        </button>
                        {menu === s.id && (
                          <div className="wui-menu" role="menu" aria-label={`Options for ${s.title}`}>
                            <button type="button" role="menuitem" onClick={() => onAskDelete(s.id)}>
                              <Trash size={13} />
                              <span>Delete</span>
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  );
});


type ColumnProps = {
  cwd: string | null;
  mode: ColumnMode;
  activeId: string | null;
  /** Something has been said in the chat open now: its row shows even while OpenCode has not titled it. */
  activeStarted?: boolean;
  /** Counts up when the list may have changed (a turn ended, a chat began). */
  refreshKey: number;
  onNew: () => void;
  onOpen: (id: string) => void;
  /** A chat was deleted from the list here. The pane announces it to every pane (sessionBus). */
  onDeleted: (id: string) => void;
  onToggle: () => void;
  /** The title this column shows for the chat open now, so the pane's tab and sidebar row can carry the same words. */
  onTitle?: (title: string) => void;
};

/** Memoised, and fed only stable callbacks by the pane, so a streamed word does not redraw it. */
export const HistoryColumn = memo(function HistoryColumn({ cwd, mode, activeId, activeStarted = false, refreshKey, onNew, onOpen, onDeleted, onToggle, onTitle }: ColumnProps) {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!cwd) return;
    let live = true;
    void listChatSessions(cwd).then(
      (list) => {
        if (!live) return;
        setSessions(list);
        setNow(Date.now());
        setFailed(null);
      },
      () => live && setFailed("Could not read your past chats."),
    );
    return () => {
      live = false;
    };
  }, [cwd, refreshKey]);

  // Review 2 P2-5: a row is blank by what is in it, not by its title. The list carries no message count, so a row
  // still called "New chat" (or OpenCode's "New session ...") is read once: one with words in it is shown. Only
  // those rows are read, once per change of their `updatedAt`, so a long list costs nothing.
  const [filled, setFilled] = useState<ReadonlySet<string>>(() => new Set());
  const probed = useRef(new Map<string, number>());
  useEffect(() => {
    if (!cwd) return;
    const todo = sessions.filter((s) => isBlankTitle(s.title) && probed.current.get(s.id) !== s.updatedAt).slice(0, 12);
    if (todo.length === 0) return;
    let live = true;
    let done = false;
    for (const s of todo) probed.current.set(s.id, s.updatedAt);
    void Promise.all(todo.map((s) => chatHistory(CHAT_AGENT, cwd, s.id).then((r) => (Array.isArray(r?.items) && r.items.length > 0 ? s.id : null), () => null))).then((ids) => {
      done = true;
      const got = ids.filter((id): id is string => id !== null);
      if (live && got.length > 0) setFilled((prev) => new Set([...prev, ...got]));
    });
    return () => {
      live = false;
      // A read cut short is asked again by the next run.
      if (!done) for (const s of todo) probed.current.delete(s.id);
    };
  }, [sessions, cwd]);

  // A chat deleted in any pane leaves every pane's list at once.
  useEffect(() => onSessionDeleted((d) => d.cwd === cwd && setSessions((xs) => xs.filter((s) => s.id !== d.id))), [cwd]);

  // The pane's tab and sidebar row follow the chat open now, with the words this list shows for it.
  const reported = useRef<{ id: string | null; title: string } | null>(null);
  useEffect(() => {
    const title = titleOf(sessions, activeId);
    // Another chat is a new thing to report, even when it has the same title as the last one.
    if (title === null || (reported.current?.id === activeId && reported.current.title === title)) return;
    reported.current = { id: activeId, title };
    onTitle?.(title);
  }, [sessions, activeId, onTitle]);

  // The "..." menu and the Delete question close on Escape, and the menu on a click anywhere else.
  useEffect(() => {
    if (menu === null && asking === null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenu(null);
      setAsking(null);
    };
    const down = (e: MouseEvent) => {
      if (menu !== null && !(e.target as Element | null)?.closest?.(".wui-menu, .wui-more")) setMenu(null);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", down);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("mousedown", down);
    };
  }, [menu, asking]);

  const remove = useCallback(
    (id: string) => {
      if (!cwd) return;
      setAsking(null);
      void deleteChatSession(cwd, id).then(
        () => {
          setSessions((xs) => xs.filter((s) => s.id !== id));
          onDeleted(id);
        },
        () => setFailed("That chat could not be deleted."),
      );
    },
    [cwd, onDeleted],
  );
  const askDelete = useCallback((id: string) => (setMenu(null), setAsking(id)), []);
  const cancelDelete = useCallback(() => setAsking(null), []);
  const visible = useMemo(() => visibleSessions(sessions, activeId, activeStarted, filled), [sessions, activeId, activeStarted, filled]);

  return (
    <HistoryView
      mode={mode}
      sessions={visible}
      now={now}
      activeId={activeId}
      query={query}
      asking={asking}
      menu={menu}
      emptyNote={failed ?? undefined}
      onQuery={setQuery}
      onNew={onNew}
      onOpen={onOpen}
      onMenu={setMenu}
      onAskDelete={askDelete}
      onCancelDelete={cancelDelete}
      onDelete={remove}
      onToggle={onToggle}
    />
  );
});
