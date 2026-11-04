// TERM-059 / TERM-060 / TERM-061 (T-220): the floating workspace panel over the app, and its button.
// The layer owns all its state (the panel's tabs, its place, the button's place) so the window only
// mounts it and asks `floatingKeys.handle` first for each key. The geometry and the tab rules are in
// geometry.ts and panel.ts (tested there). Tabs stay mounted while the panel is hidden, so a program
// keeps running when the panel is minimized. Live proof pending (batched): evidence/T-220.txt.
import { trapTab } from "../chrome/dialogFocus";
import { useEffect, useReducer, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import TerminalPane from "../terminal/TerminalPane";
import PaneMenu, { type MenuItem } from "../terminal/PaneMenu";
import { asksBeforeClose, busyCheck, closeQuestion } from "../terminal/closing";
import { editors } from "../keys/handles";
import { BrowserPane, EditorPane } from "../lazy/panes";
import type { AgentInfo } from "../launch/PlusMenu";
import type { Agent } from "../chrome/VendorMark";
import { useKeymap } from "../keys/KeymapContext";
import { matchEvent } from "../keys/keymap";
import type { Scope } from "../keys/actions";
import { heldByTerminal } from "../keys/terminalPolicy";
import { heldByOverlay } from "../keys/useWindowKeys";
import { useSettings } from "../settings/useSettings";
import {
  clampButton, insetFor, moveBy, parseButton, parseSaved, resizeBy, SETTING_BUTTON, SETTING_PANEL, shown, startsPanelMove, toggleMaximize, toStored,
  type Edge, type Pos, type Rect, type Saved, type Win, BUTTON,
} from "./geometry";
import { add, answer, asked, close, closeKey, dirtyNoteNames, empty, hide, liveTerminalTabs, modalHolds, openLink, programExited, reorder, saved, saveTarget, select, selectNumber, setDirty, setTitle, step, toggle, type Kind, type Panel } from "./panel";
import { isDirty } from "../editor/buffers";
import { startFolderFor } from "./trusted";
import { floatingUnsaved } from "./unsaved";
import { liveTerminals, SCAN_EVERY_MS, waitingTabs } from "./waitingScan";
import { routeFloating } from "../shell/inputExtras";
import "./floating.css";

/**
 * The window asks this first for every key: true means the layer handled it (a panel command, or a
 * tab command while focus is inside the open panel) and the window must do nothing more. It works on
 * every screen, so Mod+S in a floating editor saves outside a workspace screen too.
 * Cycle 3 (first load): the latch object itself lives in ./keys, so the window's shortcut router asks
 * it without loading the editors and the browser page this layer can open; it is set while mounted.
 */
import { floatingKeys } from "./keys";
export { floatingKeys };

type Props = {
  agents?: AgentInfo[];
  defaultId?: string;
  /** The folder a New note is made in (the window passes the open workspace, as its Markdown tab does); left out, New note says why it cannot. */
  home?: string;
  /** TERM-063: how many panel tabs wait on the user; the button shows a dot while above 0. */
  pending?: number;
  onToast?: (message: string) => void;
};

const EDGES: Edge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const ICON: Record<Kind, string> = { terminal: ">_", agent: "*", browser: "o", markdown: "#" };
const winSize = (): Win => ({ w: window.innerWidth, h: window.innerHeight });
/** The "+" menu: every kind of tab the panel can hold. */
const NEW_TABS: [Kind, string][] = [["terminal", "New terminal"], ["agent", "New agent"], ["browser", "New browser"], ["markdown", "New note"]];

/** The question over the panel, drawn like the editor's close dialog (CloseDialog): title, plain sentence, Cancel first and focused. */
function Question({ label, title, body, choices, onCancel, busy = false }: { label: string; title: string; body: string; choices: { name: string; kind: "danger" | "primary"; run: () => void }[]; onCancel: () => void; busy?: boolean }) {
  const cancel = useRef<HTMLButtonElement>(null);
  const chosen = useRef(false); // an answer other than Cancel: the tab it names goes, and the panel's own focus key picks the neighbour
  // Focus goes to Cancel; when the question closes without an answer it goes back to where it was (same pattern as PaneMenu).
  useEffect(() => {
    const from = document.activeElement as HTMLElement | null;
    const box = cancel.current?.closest(".ask-backdrop"); // the refs are cleared before this cleanup runs, so keep the box now
    cancel.current?.focus();
    return () => {
      const now = document.activeElement;
      if (!chosen.current && from && from.isConnected && (!now || now === document.body || !now.isConnected || !!box?.contains(now))) from.focus();
    };
  }, []);
  return (
    <div className="ask-backdrop" style={{ zIndex: 70 }} onMouseDown={onCancel}>
      <div
        className="ask"
        role="alertdialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={label}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          trapTab(e);
          if (e.key === "Escape") (e.preventDefault(), onCancel());
        }}
      >
        <h2 className="ask-title">{title}</h2>
        <div className="ask-body">{body}</div>
        <div className="btn-row">
          <button ref={cancel} className="btn" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          {choices.map((c) => (
            <button key={c.name} className={`btn ${c.kind}`} disabled={busy} onClick={() => (c.name !== "Save" && (chosen.current = true), c.run())}>
              {c.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function FloatingLayer({ agents = [], defaultId, home, pending = 0, onToast }: Props) {
  const [panel, run] = useReducer((p: Panel, f: (p: Panel) => Panel) => f(p), undefined, () => empty());
  const { settings, save } = useSettings();
  const keymap = useKeymap();
  const [win, setWin] = useState<Win>(winSize);
  const inset = insetFor(navigator.platform);
  const [place, setPlace] = useState<Saved>(() => parseSaved(null, winSize(), inset));
  const [btn, setBtn] = useState<Pos>(() => parseButton(null, winSize()));
  const [note, setNote] = useState<string | null>(null);
  const [closing, setClosing] = useState<{ keys: number[]; title: string; body: string } | null>(null); // a tab with a running program, being asked about
  const [plusAt, setPlusAt] = useState<{ top: number; left: number } | null>(null);
  const [saving, setSaving] = useState(false); // the Save choice is writing; its buttons wait until the write settles
  const [renaming, setRenaming] = useState<number | null>(null); // TERM-062: the panel tab whose name is being edited
  const loaded = useRef(false);
  const ptys = useRef<Record<number, number>>({}); // tab key -> its terminal id, for the waiting scan
  const [waiting, setWaiting] = useState<number[]>([]);

  // The saved places arrive with the settings, once.
  useEffect(() => {
    if (!settings || loaded.current) return;
    loaded.current = true;
    setPlace(parseSaved(settings[SETTING_PANEL], winSize(), inset));
    setBtn(parseButton(settings[SETTING_BUTTON], winSize()));
  }, [settings, inset]);

  useEffect(() => {
    const on = () => setWin(winSize());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  // Row 141 (TERM-063): the button's dot follows the tabs whose terminal shows an open prompt.
  const tabsRef = useRef(panel.tabs);
  tabsRef.current = panel.tabs;

  // VIEW-107 (P0): a floating note's unsaved text is lost the same way a pane's is when the window
  // quits or Force Reloads, and only the layer knows which notes hold it: the window names them in
  // its question (floating/unsaved.ts). The names change only with the tabs' titles and marks.
  const unsavedHere = dirtyNoteNames(panel);
  useEffect(() => {
    floatingUnsaved.titles = unsavedHere;
    return () => {
      floatingUnsaved.titles = [];
    };
  }, [unsavedHere.join("\n")]);

  useEffect(() => {
    let busy = false;
    const timer = window.setInterval(() => {
      if (busy) return;
      busy = true;
      void waitingTabs((c, a) => invoke(c, a), liveTerminals(ptys.current, tabsRef.current))
        .then((w) => setWaiting((old) => (old.length === w.length && old.every((k, i) => k === w[i]) ? old : w)))
        .finally(() => (busy = false));
    }, SCAN_EVERY_MS);
    return () => window.clearInterval(timer);
  }, []);

  const doAdd = (kind: Kind) => {
    setNote(null);
    // SAFE-027 (T-271): terminals and agents start only in a folder the user picked; a refusal opens nothing and says why.
    if (kind === "terminal") return void startFolderFor(invoke).then((s) => ("cwd" in s ? run((p) => add(p, { kind, cwd: s.cwd })) : setNote(s.refused)));
    if (kind === "browser") return run((p) => add(p, { kind }));
    if (kind === "agent") {
      const a = defaultId ? agents.find((x) => x.id === defaultId && x.installed) : agents.find((x) => x.installed);
      if (!a) return setNote(defaultId ? `The default agent (${defaultId}) is not installed or is switched off.` : "No agent is installed and switched on.");
      return void startFolderFor(invoke).then((s) => ("cwd" in s ? run((p) => add(p, { kind, agent: a.id, title: a.name, cwd: s.cwd })) : setNote(s.refused)));
    }
    if (!home) return setNote("A new note needs a folder to live in; open a workspace and use its Markdown tab.");
    invoke<string>("md_new", { root: home, template: null }).then(
      (path) => run((p) => add(p, { kind, path })),
      (e) => setNote(String(e)),
    );
  };

  // UX audit destructive F4: closing a floating tab whose program still runs asks first, as the window's tabs do (TERM-045).
  // A failed check asks too. Tabs with unsaved text keep their own question (panel.ts close).
  const closeTabs = async (keys: number[]) => {
    const { keys: liveKeys, ids } = liveTerminalTabs(panel, keys, ptys.current);
    const { busy, failed } = ids.length > 0 && asksBeforeClose(settings ?? {}) ? await busyCheck(ids, (list) => invoke<boolean[]>("terminal_busy", { ids: list })) : { busy: 0, failed: false };
    if (busy === 0) return run((p) => close(p, keys));
    const first = panel.tabs.find((t) => t.key === liveKeys[0]);
    setClosing({ keys, ...closeQuestion(first?.title ?? "this tab", busy, liveKeys.length, failed) });
  };

  const saveStore = (next: Saved) => void save({ [SETTING_PANEL]: toStored(next) });
  const live = useRef({ panel, place, doAdd, settings, closeTabs, modalUp: false });
  live.current = { panel, place, doAdd, settings, closeTabs, modalUp: closing !== null || asked(panel) !== null || plusAt !== null };

  useEffect(() => {
    floatingKeys.handle = (e) => {
      const { panel: p, place: pl, doAdd: addTab, settings: s, closeTabs: closeThese, modalUp } = live.current;
      // A question or the "+" menu is up (drawn outside the panel): its chords are its own, so Ctrl/Cmd+W cannot reach the window's tab.
      if (modalHolds(modalUp, e)) return (e.preventDefault(), e.stopPropagation(), true);
      const inPanel = p.open && !!document.activeElement?.closest(".float-panel");
      const activeKind = p.tabs.find((t) => t.key === p.active)?.kind;
      const scopes: Scope[] = inPanel && activeKind === "markdown" ? ["global", "tabs", "editor"] : ["global", "tabs"];
      const hit = matchEvent(keymap, e, scopes);
      if (!hit || heldByTerminal(hit.id, s)) return false;
      // UX lane C: under a menu or a modal dialog the window holds the chord (and cancels it) instead of the panel acting.
      if (!inPanel && heldByOverlay(hit.id, false)) return false;
      const op = routeFloating(hit.id, hit.index, p.open, inPanel);
      if (!op) return false;
      e.preventDefault();
      e.stopPropagation();
      switch (op.op) {
        case "toggle":
          run(toggle);
          break;
        case "minimize":
          run(hide);
          break;
        case "maximize": {
          const next = toggleMaximize(pl);
          setPlace(next);
          saveStore(next);
          break;
        }
        case "save": {
          const key = saveTarget(p, inPanel);
          if (key !== null) void editors.get(key)?.();
          break;
        }
        case "close":
          if (p.tabs.length === 0 || p.active === null) run(closeKey);
          else void closeThese([p.active]);
          break;
        case "rename":
          if (p.active !== null) setRenaming(p.active);
          break;
        case "select":
          run((q) => selectNumber(q, op.n));
          break;
        case "step":
          run((q) => step(q, op.by, op.mode));
          break;
        case "add":
          addTab(op.kind);
          break;
      }
      return true;
    };
    return () => {
      floatingKeys.handle = () => false;
    };
    // saveStore only reads `save`, which is stable enough for the next write to carry the same patch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keymap]);

  // Pointer drags: a session keeps the starting rectangle so the move is measured from the press.
  const drag = (e: React.PointerEvent, move: (dx: number, dy: number) => void, end: () => void) => {
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const onMove = (m: PointerEvent) => move(m.clientX - x0, m.clientY - y0);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      end();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const rect: Rect = shown(place, win, inset);
  const dragPanel = (e: React.PointerEvent) => {
    if (place.maximized || e.button !== 0 || !startsPanelMove(e.target as Element)) return;
    const start = place.rect;
    let latest = place;
    drag(e, (dx, dy) => setPlace((latest = { rect: moveBy(start, dx, dy, win, inset), maximized: false })), () => saveStore(latest));
  };
  const resizePanel = (edge: Edge) => (e: React.PointerEvent) => {
    if (place.maximized || e.button !== 0) return;
    const start = place.rect;
    let latest = place;
    drag(e, (dx, dy) => setPlace((latest = { rect: resizeBy(start, edge, dx, dy, win, inset), maximized: false })), () => saveStore(latest));
  };
  const dragButton = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const start = parseButton(btn, win);
    let latest = start;
    let moved = false;
    drag(
      e,
      (dx, dy) => {
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        if (moved) setBtn((latest = clampButton({ x: start.x + dx, y: start.y + dy }, win)));
      },
      () => (moved ? void save({ [SETTING_BUTTON]: latest }) : run(toggle)),
    );
  };

  const at = clampButton(btn, win); // kept inside a window that shrank; the saved place is not overwritten
  const ask = asked(panel);
  const dragFrom = useRef<number | null>(null);
  const hasTabs = panel.tabs.length > 0;

  return (
    <>
      {(panel.open || hasTabs) && (
        <div
          className={`float-panel${place.maximized ? " max" : ""}`}
          role="dialog"
          aria-label="Floating workspace panel"
          hidden={!panel.open}
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
        >
          <div className="bar" onPointerDown={dragPanel} onDoubleClick={(e) => startsPanelMove(e.target as Element) && (setPlace(toggleMaximize(place)), saveStore(toggleMaximize(place)))}>
            <div className="tabs" role="tablist">
              {panel.tabs.map((t, i) => (
                <div
                  key={t.key}
                  className={`tab${t.exited ? " exited" : ""}${waiting.includes(t.key) ? " waiting" : ""}`}
                  role="tab"
                  data-nodrag
                  aria-selected={t.key === panel.active}
                  draggable
                  onDragStart={() => (dragFrom.current = t.key)}
                  onDragOver={(e) => dragFrom.current !== null && e.preventDefault()}
                  onDrop={() => {
                    if (dragFrom.current !== null) run((p) => reorder(p, dragFrom.current as number, i));
                    dragFrom.current = null;
                  }}
                  onClick={() => run((p) => select(p, t.key))}
                >
                  <span className="ico" data-nodrag>{ICON[t.kind]}</span>
                  {renaming === t.key ? (
                    <input
                      className="name"
                      aria-label="Tab name"
                      autoFocus
                      defaultValue={t.title}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => (e.currentTarget.dataset.skip || run((p) => setTitle(p, t.key, e.currentTarget.value.trim() || t.title)), setRenaming(null))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        else if (e.key === "Escape") (e.currentTarget.dataset.skip = "1", setRenaming(null));
                      }}
                    />
                  ) : (
                    <span className="name">{t.title}</span>
                  )}
                  {waiting.includes(t.key) && <span className="unsaved" title="Waiting for you" aria-label="Waiting for you">!</span>}
                  {t.dirty && <span className="unsaved" title="Unsaved changes">●</span>}
                  <button className="x" aria-label={`Close ${t.title}`} onClick={(e) => (e.stopPropagation(), void closeTabs([t.key]))}>×</button>
                </div>
              ))}
            </div>
            <button
              className="ib"
              aria-label="New tab"
              title="New tab: terminal, agent, browser or note"
              aria-haspopup="menu"
              aria-expanded={plusAt !== null}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setPlusAt({ top: r.bottom + 4, left: r.left });
              }}
            >
              +
            </button>
            <button className="ib" aria-label={place.maximized ? "Restore" : "Maximize"} title={place.maximized ? "Restore" : "Maximize"} onClick={() => (setPlace(toggleMaximize(place)), saveStore(toggleMaximize(place)))}>{place.maximized ? "❐" : "□"}</button>
            <button className="ib" aria-label="Minimize" title="Minimize" onClick={() => run(hide)}>–</button>
          </div>
          {note && <div className="note" role="status">{note}</div>}
          <div className="body">
            {panel.tabs.map((t) => {
              const show = panel.open && t.key === panel.active;
              const wantsFocus = show;
              const info = t.agent ? agents.find((a) => a.id === t.agent) : undefined;
              return (
                <div className="slot" key={t.key} hidden={!show}>
                  {t.kind === "markdown" && t.path ? (
                    <EditorPane id={t.key} path={t.path} hidden={!show} focused={wantsFocus} onFocus={() => run((p) => select(p, t.key))} onClose={() => run((p) => close(p, [t.key]))} onDirty={(d) => run((p) => setDirty(p, t.key, d))} onToast={onToast} />
                  ) : t.kind === "browser" ? (
                    <BrowserPane id={t.key} url={t.path} title={t.title} hidden={!show} focused={wantsFocus} onFocus={() => run((p) => select(p, t.key))} onClose={() => run((p) => close(p, [t.key]))} />
                  ) : (
                    <TerminalPane
                      hidden={!show}
                      focused={wantsFocus}
                      cwd={t.cwd ?? null}
                      agent={(info && (info.id === "claude" || info.id === "codex") ? info.id : "shell") as Agent}
                      program={info?.program ?? null}
                      args={info?.args ?? []}
                      name={info?.name}
                      linksOpenInKolux={settings?.linksOpenInKolux === true}
                      onOpenLink={(url) => run((p) => openLink(p, url))}
                      onFocus={() => run((p) => select(p, t.key))}
                      onPty={(id) => (ptys.current[t.key] = id)}
                      onRunning={(on) => on === false && run((p) => programExited(p, t.key))}
                      onFailed={(why) => (setNote(`${t.title} could not start: ${why}`), onToast?.(`${t.title} could not start: ${why}`), run((p) => programExited(p, t.key)))}
                      onClose={() => void closeTabs([t.key])}
                    />
                  )}
                </div>
              );
            })}
            {!hasTabs && (
              <div className="none">
                <h3>Nothing open here</h3>
                <div>The floating panel keeps its own terminals, agents, browser and notes over whatever you are working on.</div>
                <div className="acts">
                  <button className="btn" onClick={() => doAdd("terminal")}>New terminal</button>
                  <button className="btn" onClick={() => doAdd("agent")}>New agent</button>
                  <button className="btn" onClick={() => doAdd("browser")}>New browser</button>
                  <button className="btn" onClick={() => doAdd("markdown")}>New note</button>
                  <button className="btn" onClick={() => run(hide)}>Minimize</button>
                </div>
              </div>
            )}
          </div>
          {EDGES.map((edge) => (
            <div key={edge} className={`edge ${edge}`} onPointerDown={resizePanel(edge)} />
          ))}
        </div>
      )}
      {ask && (
        <Question
          label="Save changes before closing?"
          title={`Save changes to ${ask.title}?`}
          body="Closing without saving loses them."
          busy={saving}
          onCancel={() => run((p) => answer(p, "keep"))}
          choices={[
            { name: "Don't save", kind: "danger", run: () => run((p) => answer(p, "discard")) },
            {
              name: "Save",
              kind: "primary",
              run: async () => {
                // TERM-061: close only this tab, and only when its buffer is clean after the save (panel.ts saved).
                if (saving) return;
                const { key, path } = ask;
                const write = editors.get(key);
                if (!write) return;
                setSaving(true);
                try {
                  await write();
                  run((p) => saved(p, key, path ? isDirty(path) : true));
                } finally {
                  setSaving(false);
                }
              },
            },
          ]}
        />
      )}
      {closing && (
        <Question
          label="Close this tab?"
          title={closing.title}
          body={closing.body}
          onCancel={() => setClosing(null)}
          choices={[{ name: "Close tab", kind: "danger", run: () => (setClosing(null), run((p) => close(p, closing.keys))) }]}
        />
      )}
      {plusAt && (
        <PaneMenu
          label="New tab menu"
          layer={70}
          style={{ top: plusAt.top, left: plusAt.left }}
          onDismiss={() => setPlusAt(null)}
          items={NEW_TABS.map(([kind, name]): MenuItem => ({ id: kind, name, group: 0, run: () => doAdd(kind) }))}
        />
      )}
      <button className="float-btn" style={{ left: at.x, top: at.y, width: BUTTON, height: BUTTON }} aria-label="Floating workspace panel" aria-pressed={panel.open} title="Floating workspace panel" onPointerDown={dragButton} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), run(toggle))}>
        <span aria-hidden="true">▣</span>
        {pending + waiting.length > 0 && <span className="dot" aria-label={`${pending + waiting.length} waiting`} />}
      </button>
    </>
  );
}
