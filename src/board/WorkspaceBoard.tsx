// T-142 (PROJ-085, VIEW-027): the workspace board. A lane for each status; drag a card (or a row from
// the sidebar) onto a lane to change its status. Only the lanes and cards near the visible area are
// drawn, so hundreds of cards scroll smoothly. Opens from the "Show Workspace Statuses" command; T-610:
// it is called Workspace statuses on screen, so the Board in the top bar is the only Board.
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { Close, Search } from "../chrome/icons";
import { noteUse } from "../onboarding/features";
import type { Project, Worktree } from "../projects/model";
import { projectLabel, worktreeLabel } from "../projects/model";
import { dropBand, parentDropMoves } from "../projects/parentDrop";
import {
  buildLanes, DRAG_TYPE, dragSet, droppedPaths, escapeAction, FRESH_QUERY, laneLeft, laneRange, laneWidth, listFailure, moveFailure, nearestLane, pick, selectLane, windowRange,
  type BoardCard, type BoardLane, type Status, LANE_GAP,
} from "./boardModel";
import "./board.css";

const CARD_H = 56;
const CARD_STEP = CARD_H + 6;

type Load = { statuses: Status[]; cards: BoardCard[]; trees: Record<string, Worktree[]>; unread: string[] };

async function load(): Promise<Load> {
  const projects = await invoke<Project[]>("project_list");
  const lists = await Promise.allSettled(projects.map((p) => invoke<Worktree[]>("workspace_list", { projectId: p.id })));
  const rows: Array<{ p: Project; w: Worktree }> = [];
  const trees: Record<string, Worktree[]> = {};
  const unread: string[] = []; // projects whose workspaces could not be listed
  lists.forEach((r, i) => {
    if (r.status !== "fulfilled") {
      unread.push(projectLabel(projects[i]));
      return;
    }
    trees[projects[i].id] = r.value;
    for (const w of r.value) if (!w.hidden) rows.push({ p: projects[i], w });
  });
  const st = await invoke<{ list: Status[]; of: string[] }>("workspace_statuses", { paths: rows.map((r) => r.w.path) });
  const cards = rows.map(({ p, w }, i): BoardCard => ({ path: w.path, project: projectLabel(p), projectId: p.id, label: worktreeLabel(w), branch: w.branch, status: st.of[i] ?? st.list[0]?.id ?? "", isMain: w.isMain }));
  return { statuses: st.list, cards, trees, unread };
}

export default function WorkspaceBoard({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<Load | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState(FRESH_QUERY);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<string | null>(null); // path of the card whose "Move to" list is open
  const [view, setView] = useState({ left: 0, width: 1200, height: 600 });
  const lanesRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(() => {
    load().then((d) => { setData(d); setError(""); }).catch((e) => setError(String(e)));
  }, []);
  useEffect(() => { reload(); boxRef.current?.focus(); }, [reload]);

  const measure = useCallback(() => {
    const el = lanesRef.current;
    if (el) setView({ left: el.scrollLeft, width: el.clientWidth || 1200, height: el.clientHeight || 600 });
  }, []);
  useEffect(() => {
    measure();
    const el = lanesRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, data]);

  const lanes: BoardLane[] = data ? buildLanes(data.statuses, data.cards, query) : [];
  const width = laneWidth(view.width, lanes.length);
  const [from, to] = laneRange(view.left, view.width, width, lanes.length);

  // Moves cards to a status, shown at once; a refusal puts them back and says why.
  const move = async (paths: string[], status: string) => {
    if (!data || paths.length === 0) return;
    noteUse("board");
    const before = data;
    setError("");
    const set = new Set(paths);
    setData({ ...data, cards: data.cards.map((c) => (set.has(c.path) ? { ...c, status } : c)) });
    try {
      for (const path of paths) await invoke("workspace_status_set", { path, status });
      window.dispatchEvent(new CustomEvent("kolux:workspace-status", { detail: { paths, status } }));
    } catch (e) {
      setData(before);
      setError(moveFailure(paths.length, String(e)));
    }
  };

  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    const box = lanesRef.current?.getBoundingClientRect();
    if (!box || lanes.length === 0) return;
    const i = nearestLane(e.clientX - box.left + (lanesRef.current?.scrollLeft ?? 0), lanes.length, width);
    const paths = droppedPaths(e.dataTransfer.getData(DRAG_TYPE));
    const known = new Set(data?.cards.map((c) => c.path));
    void move(paths.filter((p) => known.has(p)), lanes[i].status.id);
  };

  // T-186-b: the middle of a card nests the dragged workspaces under it, as a sidebar row does; the edges fall through to the lane's status drop.
  const nest = (e: React.DragEvent<HTMLElement>, card: BoardCard) => {
    if (!data) return;
    const r = e.currentTarget.getBoundingClientRect();
    const moves = parentDropMoves(data.trees[card.projectId] ?? [], droppedPaths(e.dataTransfer.getData(DRAG_TYPE)), card.path, dropBand(e.clientY - r.top, r.height));
    if (moves.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    noteUse("board");
    void (async () => {
      try {
        for (const m of moves) await invoke("workspace_set_parent", { projectId: card.projectId, path: m.path, parent: m.parent });
      } catch (err) {
        setError(String(err));
      }
      reload();
    })();
  };

  const keys = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    if (escapeAction(menu !== null) === "close-popover") setMenu(null);
    else onClose();
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={boxRef} className="ws-board" role="dialog" aria-modal="true" aria-label="Workspace statuses" tabIndex={-1} onKeyDown={keys}>
        <header className="board-head">
          <h2>Workspace statuses</h2>
          <label className="board-search">
            <Search />
            <input className="field" type="search" placeholder="Search workspaces" aria-label="Search workspace statuses" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button className="ib" aria-label="Close workspace statuses" onClick={onClose}><Close /></button>
        </header>
        {error && (
          <p className="board-error" role="alert">
            {error}
            {!data && <> <button className="btn" onClick={reload}>Retry</button></>}
          </p>
        )}
        {data && listFailure(data.unread) && (
          <p className="board-error" role="alert">
            {listFailure(data.unread)} <button className="btn" onClick={reload}>Retry</button>
          </p>
        )}
        {!data && !error && <p className="board-note">Loading workspaces…</p>}
        {data && data.cards.length === 0 && data.unread.length === 0 && <p className="board-note" role="status">No workspaces yet. Add a project in the sidebar and its workspaces show up here, one lane for each status.</p>}
        {data && (
          <div
            className="board-lanes"
            ref={lanesRef}
            onScroll={measure}
            onDragOver={(e) => e.preventDefault()}
            onDrop={drop}
          >
            <div className="board-canvas" style={{ width: laneLeft(lanes.length, width) }}>
              {lanes.slice(from, to).map((lane, k) => (
                <Lane
                  key={lane.status.id}
                  lane={lane}
                  left={laneLeft(from + k, width)}
                  width={width}
                  statuses={data.statuses}
                  selected={selected}
                  menu={menu}
                  onSelectLane={() => setSelected(selectLane(lane))}
                  onPick={(path, add) => setSelected((s) => pick(s, path, add))}
                  onMenu={setMenu}
                  onMove={(paths, status) => { setMenu(null); void move(paths, status); }}
                  onNest={nest}
                />
              ))}
            </div>
          </div>
        )}
        {data && <footer className="board-foot">{data.cards.length} workspaces · {lanes.length} lanes{selected.size > 0 ? ` · ${selected.size} selected` : ""}</footer>}
      </div>
    </div>
  );
}

function Lane({ lane, left, width, statuses, selected, menu, onSelectLane, onPick, onMenu, onMove, onNest }: {
  lane: BoardLane; left: number; width: number; statuses: Status[]; selected: Set<string>; menu: string | null;
  onSelectLane: () => void; onPick: (path: string, additive: boolean) => void; onMenu: (path: string | null) => void; onMove: (paths: string[], status: string) => void;
  onNest: (e: React.DragEvent<HTMLElement>, card: BoardCard) => void;
}) {
  const [scroll, setScroll] = useState(0);
  const [h, setH] = useState(500);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { if (body.current?.clientHeight) setH(body.current.clientHeight); }, [width]);
  const [a, b] = windowRange(scroll, h, CARD_STEP, lane.cards.length);
  return (
    <section className="board-lane" style={{ left, width }} aria-label={`${lane.status.label}, ${lane.cards.length} workspaces`}>
      <button className="board-lane-head" onClick={onSelectLane} title="Select every workspace in this lane">
        <span className="board-lane-name">{lane.status.label}</span>
        <span className="board-count">{lane.cards.length}</span>
      </button>
      <div className="board-lane-body" ref={body} onScroll={(e) => setScroll(e.currentTarget.scrollTop)}>
        <div style={{ height: lane.cards.length * CARD_STEP, position: "relative" }}>
          {lane.cards.slice(a, b).map((c, k) => (
            <article
              key={c.path}
              className="board-card"
              data-selected={selected.has(c.path) || undefined}
              style={{ top: (a + k) * CARD_STEP, height: CARD_H }}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragSet(selected, c.path)));
                e.dataTransfer.effectAllowed = "move";
              }}
              onDrop={(e) => onNest(e, c)}
              onClick={(e) => onPick(c.path, e.ctrlKey || e.metaKey || e.shiftKey)}
            >
              <div className="board-card-title">{c.label}</div>
              <div className="board-card-sub">{c.project}{c.branch && c.branch !== c.label ? ` · ${c.branch}` : ""}</div>
              <button className="board-move" aria-haspopup="menu" aria-expanded={menu === c.path} title="Move to another lane" onClick={(e) => { e.stopPropagation(); onMenu(menu === c.path ? null : c.path); }}>Move</button>
              {menu === c.path && (
                <ul className="board-menu" role="menu" style={{ marginLeft: -LANE_GAP }}>
                  {statuses.map((s) => (
                    <li key={s.id}>
                      <button role="menuitem" disabled={s.id === c.status} onClick={(e) => { e.stopPropagation(); onMove(dragSet(selected, c.path), s.id); }}>{s.label}</button>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
