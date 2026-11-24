// The chat history column (2026-11-24, the Open WebUI screen): New chat, a search over titles and the past
// chats of this folder grouped by day. `HistoryView` only draws what it is given; `HistoryColumn` loads the
// list from OpenCode and holds the search, the "..." menu and the delete question.
import { useEffect, useState } from "react";
import { Dots, PanelLeft, Plus, Search, Trash } from "../../chrome/icons";
import { deleteChatSession, listChatSessions, type ChatSessionSummary } from "../opencode";
import { filterSessions, groupSessions, type ColumnMode } from "./history";

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

export function HistoryView({ mode, sessions, now, activeId, query, asking, menu = null, onQuery, onNew, onOpen, onMenu, onAskDelete, onCancelDelete, onDelete, onToggle, emptyNote }: HistoryViewProps) {
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
  const groups = groupSessions(filterSessions(sessions, query), now);
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
}

type ColumnProps = {
  cwd: string | null;
  mode: ColumnMode;
  activeId: string | null;
  /** Counts up when the list may have changed (a turn ended, a chat began). */
  refreshKey: number;
  onNew: () => void;
  onOpen: (id: string) => void;
  /** A chat was deleted from the list; the open one going away starts a new chat. */
  onDeleted: (id: string) => void;
  onToggle: () => void;
};

export function HistoryColumn({ cwd, mode, activeId, refreshKey, onNew, onOpen, onDeleted, onToggle }: ColumnProps) {
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

  const remove = (id: string) => {
    if (!cwd) return;
    setAsking(null);
    void deleteChatSession(cwd, id).then(
      () => {
        setSessions((xs) => xs.filter((s) => s.id !== id));
        onDeleted(id);
      },
      () => setFailed("That chat could not be deleted."),
    );
  };

  return (
    <HistoryView
      mode={mode}
      sessions={sessions}
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
      onAskDelete={(id) => (setMenu(null), setAsking(id))}
      onCancelDelete={() => setAsking(null)}
      onDelete={remove}
      onToggle={onToggle}
    />
  );
}
