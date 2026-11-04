// APP-014: the right-click menu of text fields, mounted once. A right-click outside editable text gets no
// menu at all. Inside a field the rows come from editMenuModel.ts; on Windows the engine also reports its
// spelling suggestions (edit_menu.rs), which sit at the top. Elsewhere the menu carries the edit rows only
// (no suggestions on macOS or Linux: the web view gives the page no way to ask for them).
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { detectPlatform } from "../keys/keymap";
import { useMenuFocus } from "../chrome/dialogFocus";
import { fitIn, outsideDismisses } from "../terminal/PaneMenu";
import { SuggestionGate } from "./suggestionGate";
import { editMenuItems, fieldKind, type EditAction, type EditItem, type FieldLike } from "./editMenuModel";

const SUGGESTIONS_EVENT = "edit-menu-suggestions";
/** How long the page waits for the engine's suggestions before drawing the menu without them. */
const SUGGESTION_WAIT_MS = 300;

type Box = HTMLInputElement | HTMLTextAreaElement;
const isBox = (el: Element): el is Box => el.tagName === "INPUT" || el.tagName === "TEXTAREA";

export function describeField(el: Element | null): FieldLike | null {
  if (!el) return null;
  const box = isBox(el) ? el : null;
  return {
    tag: el.tagName,
    type: box && el.tagName === "INPUT" ? (box as HTMLInputElement).type : undefined,
    readOnly: box?.readOnly,
    disabled: box?.disabled,
    contentEditable: (el as HTMLElement).isContentEditable,
    inTerminal: !!el.closest(".xterm"),
  };
}

function hasSelection(el: Element): boolean {
  if (isBox(el)) return el.selectionStart !== el.selectionEnd;
  return (window.getSelection()?.toString() ?? "") !== "";
}

/** Runs one row on the field; focus goes back first so the browser's edit commands act on it. */
export function runEdit(el: HTMLElement, action: EditAction, onToast?: (m: string) => void): void {
  el.focus();
  switch (action.kind) {
    case "suggest":
      document.execCommand("insertText", false, action.word);
      break;
    case "cut":
    case "copy":
      document.execCommand(action.kind);
      break;
    case "selectAll":
      if (isBox(el)) el.select();
      else document.execCommand("selectAll");
      break;
    case "paste":
      navigator.clipboard
        .readText()
        .then((t) => {
          if (t) document.execCommand("insertText", false, t);
        })
        .catch(() => onToast?.("The clipboard could not be read; paste with the keyboard instead"));
      break;
  }
}

type Open = { x: number; y: number; items: EditItem[]; target: HTMLElement };

export default function EditMenuHost({ onToast }: { onToast?: (m: string) => void }) {
  const [menu, setMenu] = useState<Open | null>(null);
  useEffect(() => {
    const platform = detectPlatform();
    const gate = new SuggestionGate();
    let hooked = false;
    let cancelled = false;
    let timer = 0;
    let waiting: ((words: string[]) => void) | null = null;
    const un = listen<{ words: string[]; seq: number }>(SUGGESTIONS_EVENT, (e) => {
      if (gate.answer(e.payload.seq)) waiting?.(e.payload.words ?? []);
    });
    // The host hides the engine's menu only after this call, so a menu is never hidden with nobody to draw ours.
    un.then(() => (cancelled ? undefined : invoke<boolean>("edit_menu_ready", { ready: true }).then((v) => (hooked = v)))).catch(() => {});
    const abandon = () => {
      window.clearTimeout(timer);
      if (waiting) gate.timedOut();
      waiting = null;
    };
    const onContext = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      abandon();
      const target = e.target instanceof HTMLElement ? e.target : null;
      const kind = fieldKind(describeField(target));
      if (!target || kind === "none") {
        e.preventDefault();
        return;
      }
      const { clientX: x, clientY: y } = e;
      const show = (suggestions: string[]) => {
        waiting = null;
        setMenu({ x, y, target, items: editMenuItems({ kind, hasSelection: hasSelection(target), suggestions, platform }) });
      };
      // Left alone, the engine raises its own event (which carries the suggestions) and draws no menu of its own.
      if (hooked && kind === "editable") {
        gate.begin();
        timer = window.setTimeout(() => (abandon(), show([])), SUGGESTION_WAIT_MS);
        waiting = (words) => (window.clearTimeout(timer), show(words));
      } else {
        e.preventDefault();
        show([]);
      }
    };
    document.addEventListener("contextmenu", onContext);
    return () => {
      cancelled = true;
      abandon();
      invoke("edit_menu_ready", { ready: false }).catch(() => {});
      document.removeEventListener("contextmenu", onContext);
      void un.then((f) => f());
    };
  }, []);
  return menu && <Menu menu={menu} onDismiss={() => setMenu(null)} onToast={onToast} />;
}

function Menu({ menu, onDismiss, onToast }: { menu: Open; onDismiss: () => void; onToast?: (m: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const openedAt = useRef(performance.now());
  // T-710: focus goes to the first row, Up/Down move, Enter picks, Escape closes and focus goes back to the field.
  useMenuFocus(box, true, onDismiss);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.top = `${fitIn(r.top, r.height, window.innerHeight)}px`;
    el.style.left = `${fitIn(r.left, r.width, window.innerWidth)}px`;
  }, [menu.items.length]);
  const outside = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (outsideDismisses(openedAt.current, performance.now())) onDismiss();
  };
  const { items } = menu;
  return (
    <>
      <div className="menu-backdrop" onClick={outside} onContextMenu={outside} aria-hidden="true" />
      <div ref={box} className="menu edit-menu" role="menu" aria-label="Text menu" style={{ top: menu.y, left: menu.x }}>
        {items.map((it, i) => (
          <Fragment key={it.id}>
            {i > 0 && items[i - 1].group !== it.group && <div role="separator" style={{ height: 1, margin: "4px 6px", background: "var(--line-strong)" }} />}
            <button
              role="menuitem"
              className="menu-item"
              disabled={it.disabled}
              // Pressing a row moves no focus: runEdit puts it back on the field, whose selection is kept.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => (onDismiss(), runEdit(menu.target, it.action, onToast))}
            >
              <span className="name">{it.name}</span>
              {it.shortcut && <span className="muted">{it.shortcut}</span>}
            </button>
          </Fragment>
        ))}
      </div>
    </>
  );
}
