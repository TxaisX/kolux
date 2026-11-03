// EDIT-011 (T-234-b): draws the hover controls of a table (a plus between two rows or columns, a cross on
// the one under the pointer) and the right-click menu for a cell. The geometry and the edits are in
// tableHover.ts and richTable.ts. The controls sit in the strip outside the table so they never cover a cell.
import { useEffect, useState } from "react";
import type { LexicalEditor } from "lexical";
import { runTableEdit, tablesOf } from "./richTable";
import { hoverControls, menuEdits, type Control, type Geo } from "./tableHover";

const SIZE = 18;

/** The cell menu closes on a press anywhere outside it (the menu stops its own presses) and on Escape.
 *  Presses are read as pointerdown: Tauri's drag script stops the mousedown of a press on the top bar,
 *  which is a drag region end to end (T-620), so a mousedown listener here would miss those presses. */
export function watchMenuClose(win: Pick<Window, "addEventListener" | "removeEventListener">, close: () => void): () => void {
  const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
  win.addEventListener("pointerdown", close);
  win.addEventListener("keydown", esc);
  return () => {
    win.removeEventListener("pointerdown", close);
    win.removeEventListener("keydown", esc);
  };
}

/** Why a cell-menu row is greyed out, so the grey is not a mystery (null when the row is on). */
export function whyDisabled(label: string, disabled: boolean): string | undefined {
  if (!disabled) return undefined;
  return label === "Delete row" ? "The header row cannot be deleted" : "Not available here";
}

/** A table's box and its row and column edges in screen pixels. */
function geoOf(el: HTMLElement): Geo | null {
  const t = el as HTMLTableElement;
  const rows = Array.from(t.rows ?? []);
  if (rows.length === 0) return null;
  const box = el.getBoundingClientRect();
  const rr = rows.map((r) => r.getBoundingClientRect());
  const cc = Array.from(rows[0].cells).map((c) => c.getBoundingClientRect());
  if (cc.length === 0) return null;
  return {
    left: box.left,
    top: box.top,
    right: box.right,
    bottom: box.bottom,
    rows: [rr[0].top, ...rr.map((r) => r.bottom)],
    cols: [cc[0].left, ...cc.map((c) => c.right)],
  };
}

type Shown = { geo: Geo; rows: Control[]; cols: Control[] };
type Menu = { x: number; y: number; items: ReturnType<typeof menuEdits> };

export default function TableControls({ editor }: { editor: LexicalEditor | null }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);

  useEffect(() => {
    if (!editor) return;
    let frame = 0;
    const move = (e: MouseEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        for (const { key, el } of tablesOf(editor)) {
          const geo = geoOf(el);
          if (!geo) continue;
          const c = hoverControls(key, geo, e.clientX, e.clientY);
          if (c.rows.length || c.cols.length) return setShown({ geo, ...c });
        }
        setShown(null);
      });
    };
    const ctx = (e: MouseEvent) => {
      const cell = (e.target as HTMLElement | null)?.closest?.("td, th") as HTMLTableCellElement | null;
      const row = cell?.parentElement as HTMLTableRowElement | null;
      const table = row?.closest("table");
      if (!cell || !row || !table) return;
      const hit = tablesOf(editor).find((t) => t.el === table);
      if (!hit) return;
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, items: menuEdits(hit.key, row.rowIndex, cell.cellIndex, row.cells.length) });
    };
    const root = editor.getRootElement();
    document.addEventListener("mousemove", move);
    root?.addEventListener("contextmenu", ctx);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousemove", move);
      root?.removeEventListener("contextmenu", ctx);
    };
  }, [editor]);

  useEffect(() => (menu ? watchMenuClose(window, () => setMenu(null)) : undefined), [menu]);

  const run = (e: Parameters<typeof runTableEdit>[1]) => {
    if (editor) runTableEdit(editor, e);
    setShown(null);
    setMenu(null);
  };
  return (
    <>
      {shown &&
        shown.rows.map((c) => (
          <button key={`r${c.kind}${c.at}`} type="button" className={`table-ctl ${c.kind}`} style={{ left: shown.geo.left - SIZE - 4, top: c.at - SIZE / 2 }} title={c.kind === "add" ? "Add a row here" : "Delete this row"} aria-label={c.kind === "add" ? "Add row" : "Delete row"} onMouseDown={(e) => e.preventDefault()} onClick={() => run(c.edit)}>
            {c.kind === "add" ? "+" : "×"}
          </button>
        ))}
      {shown &&
        shown.cols.map((c) => (
          <button key={`c${c.kind}${c.at}`} type="button" className={`table-ctl ${c.kind}`} style={{ left: c.at - SIZE / 2, top: shown.geo.top - SIZE - 4 }} title={c.kind === "add" ? "Add a column here" : "Delete this column"} aria-label={c.kind === "add" ? "Add column" : "Delete column"} onMouseDown={(e) => e.preventDefault()} onClick={() => run(c.edit)}>
            {c.kind === "add" ? "+" : "×"}
          </button>
        ))}
      {menu && (
        <div className="table-ctx" role="menu" aria-label="Table" style={{ left: Math.min(menu.x, window.innerWidth - 170), top: Math.min(menu.y, window.innerHeight - 200) }} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => (e.stopPropagation(), e.preventDefault())}>
          {menu.items.map((it) => (
            <button key={it.label} type="button" role="menuitem" className="table-ctx-item" disabled={it.disabled} title={whyDisabled(it.label, it.disabled)} onClick={() => run(it.edit)}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
