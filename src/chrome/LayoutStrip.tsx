// The 40 px layout strip (DESIGN.md section 6): "Layout" and the 1 / 2 / 4 / 6 group. A button
// sets how many cells the workspace in front holds (TERM-001); the pressed one is the current
// count, so none is pressed at 3, 5 or above 6. On the right, "New tab" opens the tab create menu
// (TERM-040 / TERM-041, SESS-006): one terminal per installed shell, or any installed agent, as a
// tab beside the focused pane; "Choose agent…" (an empty chooser pane, nothing started); the
// browser; a new or an existing markdown file; or a file from disk in an editor tab (EDIT-001).
import { useRef, useState, type ReactNode } from "react";
import { FileCode, Globe, Plus } from "./icons";
import VendorMark from "./VendorMark";
import { useMenuFocus } from "./dialogFocus";
import { Kbd } from "../keys/KeymapContext";
import { markFor, type AgentInfo } from "../launch/PlusMenu";
import StripTotals from "../usage/StripTotals";

const choices = [1, 2, 4, 6];

/** SESS-006: an installed shell, from `shell_list`; the first is the one Ctrl+T opens. */
export type ShellInfo = { id: string; name: string; program: string; args: string[] };

/** What a new tab runs: an agent, the default shell (null) or another one, the browser (BROW-001),
 * a chooser pane or a markdown file (SESS-006), or a file picked from disk (EDIT-001). */
export type NewTab = AgentInfo | null | { shell: ShellInfo } | "browser" | "file" | "diff" | "changes" | "chooser" | "markdown-new" | "markdown-open";
/** `preview`: T-242 (BROW-067), the Preview button shown beside "New tab" (browser/PreviewButton). */
type Props = { count: number; onLayout: (n: number) => void; agents?: AgentInfo[]; shells?: ShellInfo[]; onNewTab?: (what: NewTab) => void; open?: boolean; preview?: ReactNode };

export default function LayoutStrip({ count, onLayout, agents = [], shells = [], onNewTab, open = false, preview }: Props) {
  const [at, setAt] = useState<{ top: number; right: number } | null>(open ? { top: 0, right: 0 } : null);
  const menu = useRef<HTMLDivElement>(null);
  // Focus moves to the first row, arrows move between rows, and Escape closes the menu instead of reaching the terminal.
  useMenuFocus(menu, at !== null, () => setAt(null));
  const pick = (a: NewTab) => {
    setAt(null);
    onNewTab?.(a);
  };
  return (
    <div className="strip">
      <span>Layout</span>
      <div className="layouts" role="group" aria-label="Panes per screen">
        {choices.map((n) => (
          <button key={n} aria-pressed={count === n} onClick={() => onLayout(n)} title={n === 1 ? "One pane" : `${n} panes: empty panes are added, unstarted ones removed`}>
            {n}
          </button>
        ))}
      </div>
      {/* The totals sit at the right end of the strip, immediately left of Preview. */}
      <span className="strip-right" style={{ marginLeft: "auto" }}>
        <StripTotals />
        {preview}
      </span>
      {onNewTab && (
        <button
          className="btn newtab"
          style={{ marginLeft: 8 }}
          aria-haspopup="menu"
          aria-expanded={at !== null}
          title="New tab beside the focused pane (Ctrl+T for a shell)"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setAt({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
          }}
        >
          <Plus size={12} /> New tab
        </button>
      )}
      {at && (
        <>
          <div className="menu-backdrop" onClick={() => setAt(null)} aria-hidden="true" />
          <div ref={menu} className="menu" role="menu" aria-label="New tab" style={at}>
            <div className="menu-title">New tab</div>
            {(shells.length ? shells : [null]).map((sh, i) => (
              <button key={sh?.id ?? "shell"} role="menuitem" className="menu-item" onClick={() => pick(i === 0 || !sh ? null : { shell: sh })} title={sh ? `New terminal: ${sh.program}` : "New terminal"}>
                <span className="agent-mark">
                  <VendorMark agent="shell" size={14} />
                </span>
                <span className="name">{sh ? `Terminal · ${sh.name}` : "Terminal"}</span>
                {i === 0 && <Kbd id="tab.newTerminal" />}
              </button>
            ))}
            <button role="menuitem" className="menu-item" onClick={() => pick("chooser")} title="A pane that asks which AI, model or terminal to run; nothing starts until you press Start">
              <span className="agent-mark" aria-hidden="true">
                ?
              </span>
              <span className="name">Choose agent…</span>
            </button>
            {agents.map((a) => (
              <button key={a.id} role="menuitem" className="menu-item" onClick={() => pick(a)}>
                <span className="agent-mark">
                  <VendorMark agent={markFor(a.id)} size={14} />
                </span>
                <span className="name">{a.name}</span>
                <Kbd id={`tab.newAgent.${a.id}`} />
              </button>
            ))}
            <button role="menuitem" className="menu-item" onClick={() => pick("browser")}>
              <span className="agent-mark">
                <Globe size={14} />
              </span>
              <span className="name">Browser</span>
              <Kbd id="tab.newBrowser" />
            </button>
            <button role="menuitem" className="menu-item" onClick={() => pick("markdown-new")}>
              <span className="agent-mark">
                <FileCode size={14} />
              </span>
              <span className="name">New markdown file</span>
              <Kbd id="tab.newMarkdown" />
            </button>
            <button role="menuitem" className="menu-item" onClick={() => pick("markdown-open")}>
              <span className="agent-mark">
                <FileCode size={14} />
              </span>
              <span className="name">Open markdown file…</span>
              <Kbd id="tab.openMarkdown" />
            </button>
            <button role="menuitem" className="menu-item" onClick={() => pick("file")}>
              <span className="agent-mark">
                <FileCode size={14} />
              </span>
              <span className="name">File…</span>
            </button>
            <button role="menuitem" className="menu-item" onClick={() => pick("diff")}>
              <span className="agent-mark">
                <FileCode size={14} />
              </span>
              <span className="name">Changed file diff…</span>
            </button>
            <button role="menuitem" className="menu-item" onClick={() => pick("changes")}>
              <span className="agent-mark">
                <FileCode size={14} />
              </span>
              <span className="name">All Changes</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
