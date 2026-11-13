// Cycle 3 (the WindowView split): the pane grid, moved out of shell/WindowView.tsx as it was: the
// lanes on the Board, the empty state, one cell per pane (TERM-017) with its drag and drop (TERM-015) and
// the pane body (Pane.tsx). The grid's frame follows the screen it is on (VIEW-026, TERM-013).
// Owner decision 2026-11-12 (docs/plans/clean-ui-one-session-per-cell.md): one session per cell, no per-cell tab
// strip. What a tab did is the pane header's now: its marks (PaneTab.tsx), and here, on the cell, a middle-click
// on the header closes an unpinned pane (TERM-049), a double-click on a terminal's title renames it (TERM-048) and a
// right-click on a header without a Pane menu of its own opens the tab menu (TabMenuView.tsx).
import { folderName } from "../../projects/model";
import { templateOf } from "../../terminal/dividers";
import { zoneOf } from "../../terminal/rearrange";
import { middleClickCloses } from "../../terminal/pin";
import { sameDir, viewOf } from "../../workspaces";
import Pane from "./Pane";
import { gridFrame } from "./gridFrame";
import { menuAnchor } from "./tabMenuStart";
import { useWindow } from "./store";

/** Whether a pointer event landed in a pane's header (not in a field or the terminal under it). */
const onHead = (t: EventTarget | null): boolean => !!(t as Element | null)?.closest?.(".pane-head");

export default function Grid() {
  const {
    board, agentsScreen, zoomed, classic, terminals, page, onDividerDown, onDividerMove, endDividerDrag,
    weightsOf, lanes, shown, activeDir, addShell, addChooser, cells, selected, dropHint, dragging,
    setDropHint, dropCellOn, pinned, closePane, setTabMenu, setAskName,
  } = useWindow();
  const frame = gridFrame({ board, agentsScreen, zoomed, classic, terminals, pageOpen: page !== null, selected });
  return (
    <div
      className={frame.className}
      hidden={frame.hidden}
      onPointerDown={onDividerDown}
      onPointerMove={onDividerMove}
      onPointerUp={endDividerDrag}
      onPointerCancel={endDividerDrag}
      onLostPointerCapture={endDividerDrag}
      style={terminals ? { gridTemplateColumns: templateOf(weightsOf("col")), gridTemplateRows: templateOf(weightsOf("row")) } : board ? { gridTemplateColumns: `repeat(${lanes.length || 1}, minmax(0, 1fr))` } : undefined}
    >
      {board &&
        lanes.map((l, i) => (
          <h3 key={l.id} className="lane" style={{ gridColumn: i + 1 }}>
            {l.title}
          </h3>
        ))}
      {terminals && shown.length === 0 && (
        <div className="empty">
          <h2>{activeDir ? folderName(activeDir) : "Terminal"}</h2>
          <p>No terminal open here.</p>
          <div className="btn-row">
            <button className="btn" onClick={() => addShell(activeDir, null)}>
              Open a shell
            </button>
            <button className="btn" onClick={addChooser}>
              Choose what to run
            </button>
          </div>
        </div>
      )}
      {/* TERM-017: cells are keyed by their pane (one session per cell), so a split, a close or a drag only inserts,
          drops or reorders cells: no pane is ever drawn anew and every terminal keeps running. */}
      {cells.map((c) => {
        const p = c.panes[0];
        // VIEW-015: on the Agents screen the picked session is the one shown.
        const mine = agentsScreen && p.key === selected;
        return (
          <div
            key={c.group}
            className="cell"
            data-drop={dropHint?.group === c.group ? dropHint.zone : undefined}
            hidden={agentsScreen ? !mine : !board && (!sameDir(viewOf(p), activeDir) || (zoomed !== null && c.group !== zoomed))}
            onDragOver={(e) => {
              if (!dragging.current) return;
              e.preventDefault();
              setDropHint({ group: c.group, zone: zoneOf(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect()) });
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHint((h) => (h?.group === c.group ? null : h));
            }}
            onDrop={(e) => {
              const d = dragging.current;
              if (!d) return;
              e.preventDefault();
              const zone = zoneOf(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
              dragging.current = null;
              setDropHint(null);
              dropCellOn(d.cell, { group: c.group, zone });
            }}
            onAuxClick={(e) => {
              // TERM-049 / TERM-046: a middle-click on the pane header closes the pane, as it closed its tab; a pinned one stays.
              if (e.button !== 1 || !onHead(e.target) || !middleClickCloses(p.key, pinned)) return;
              e.preventDefault();
              closePane(p.key);
            }}
            onDoubleClick={(e) => {
              // TERM-048: a double-click on a terminal's title opens its name field (the header's, as Set Title does).
              if (p.kind || p.seats || !(e.target as Element | null)?.closest?.(".pane-head .title")) return;
              setAskName((m) => ({ ...m, [p.key]: (m[p.key] ?? 0) + 1 }));
            }}
            onContextMenu={(e) => {
              // TERM-049: a header that opened its own Pane menu (a terminal's) already took the click; any other
              // header opens the tab menu where the pointer is.
              if (e.defaultPrevented || !onHead(e.target)) return;
              e.preventDefault();
              setTabMenu({ key: p.key, ...menuAnchor(e.clientX, e.clientY, window.innerWidth, window.innerHeight) });
            }}
          >
            <Pane pane={p} />
          </div>
        );
      })}
    </div>
  );
}
