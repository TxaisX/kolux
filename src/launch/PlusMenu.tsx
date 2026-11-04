// The plus menu (SESS-001, SESS-004, SESS-002, SESS-003, SESS-010): which agent to start in a new pane. The list comes from the
// Rust side, which looks each agent's program up on the PATH and in the usual install folders;
// only agents that were found are offered, the rest stay out of sight (SESS-001). The default
// agent is listed first with its shortcut beside it, when one is bound; every other row has a
// "default" button that makes that agent the default. Drawn as a fixed popover with a click-away
// backdrop, so it is never clipped by the pane or sidebar card it opens from. SESS-009: Claude Code,
// Codex and Grok lead and the rest fold behind "Show more agents" (folded again on each open); the
// search box reaches every installed agent; a blank-terminal row and "Manage agents" sit at the foot.
// SESS-039: opened from a pane with a worktree folder, it also offers "Open in <editor>" for each
// outside editor installed (editors.ts). TERM-042: with `entry` the menu opens with an entry box for a
// URL, a file or an open tab; TERM-043: on a local Windows client a "Terminal" row opens the shell choice.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { watchEscape } from "../switcher/accounts";
import { restoreFocus } from "../shell/paletteCaps";
import { menuStep } from "../terminal/LinkActionMenu";
import VendorMark, { type Agent } from "../chrome/VendorMark";
import AgentMark from "../marks/AgentMark";
import { Kbd, useLabel } from "../keys/KeymapContext";
import { agents as AGENT_NAMES } from "../keys/actions";
import { agentRows, MAX_SEARCH, searchAgents, wantsTerminal, type AgentPass } from "./agents";
import { openIn, openLabel, openTitle, useEditors, type Editor } from "./editors";
import { markFor } from "./paneMark";
import NewTabEntryBox from "./NewTabEntryBox";
import type { EntryTarget } from "./newTabEntryRun";
import ShellMark from "../terminal/ShellMark";
import { shellIconOf, windowsShellMenu, type ShellEntry } from "../terminal/shellChoice";
import "./plusMenuExtras.css";

export type AgentInfo = { id: string; name: string; program: string; args: string[]; installed: boolean; path: string | null; docs?: boolean;
  /** T-570: Kolux knows an official install route for this agent on this OS; `install` is that command in words (a tooltip). */
  installable?: boolean; install?: string | null };

// FIX-3: markFor, paneMark and the credit rule live in paneMark.ts (one rule shared with Rust); re-exported so every caller keeps its import.
export { markFor, paneMark } from "./paneMark";

/** ACCT-046: the pane-header word for the shell an automatic pane actually started. */
export function shellWord(path: string): string {
  const stem = (path.split(/[\\/]/).pop() ?? path).replace(/\.exe$/i, "").toLowerCase();
  return ({ pwsh: "PowerShell 7", powershell: "Windows PowerShell", cmd: "Command Prompt" } as Record<string, string>)[stem] ?? stem;
}

/** The pane-header word for what runs in a pane. Review of PR #16 (b): an agent with no vendor mark of its own
 *  (Gemini, Grok, Devin...; board/chip.ts paneAgent names it by its catalogue id) is called by its name. */
export function programWord(agent: Agent | string): string {
  if (agent === "claude") return "Claude";
  if (agent === "codex") return "Codex";
  if (agent === "shell") return "PowerShell";
  return AGENT_NAMES.find(([id]) => id === agent)?.[1] ?? agent;
}

type Props = {
  agents: AgentInfo[];
  /** The default agent's id: listed first and marked, with the "new agent tab" shortcut beside it. */
  defaultId?: string;
  onPick: (agent: AgentInfo) => void;
  onSetDefault?: (id: string) => void;
  /** Opens a chooser pane instead (SESS-007). */
  onChoose?: () => void;
  onClose: () => void;
  /** The blank-terminal row: a plain shell instead of an agent. */
  onTerminal?: () => void;
  /** "Manage agents": Settings > Agents. */
  onManage?: () => void;
  busy?: boolean;
  style?: CSSProperties;
  /** SESS-003: agents are installed but every one is switched off. */
  allOff?: boolean;
  /** SESS-002: where the agent search stands, and a way to look again. */
  pass?: AgentPass;
  onRefresh?: () => void;
  /** SESS-039: the pane's worktree folder; with it the menu offers "Open in <editor>" rows. */
  dir?: string;
  /** The editors to offer; looked up from the Rust side when left out. */
  editors?: Editor[];
  /** TERM-042: the entry box; `tabs` are the open tabs it can jump to, `onRun` opens what a row names. */
  entry?: { tabs: { key: number; name: string }[]; onRun: (target: EntryTarget) => void };
  /** TERM-043: the installed shells; the choice shows on a local Windows client only. */
  shells?: ShellEntry[];
  onShell?: (shell: ShellEntry) => void;
  /** False for a remote client (the shell choice is local only); `windows` is for tests. */
  local?: boolean;
  windows?: boolean;
  /** Name of the project a new session starts in; shown as a small heading at the top of the menu. */
  target?: string;
};

function ShellGlyph({ program }: { program: string }) {
  const icon = shellIconOf(program);
  return icon === "shell" ? <VendorMark agent="shell" size={13} /> : <ShellMark icon={icon} />;
}

export default function PlusMenu({ agents, defaultId = "", onPick, onSetDefault, onChoose, onClose, onTerminal, onManage, busy = false, style, allOff = false, pass, onRefresh, dir, editors, entry, shells = [], onShell, local = true, windows, target }: Props) {
  const [shellsOpen, setShellsOpen] = useState(false);
  const shellChoices = onShell ? windowsShellMenu(shells, { windows: windows ?? (typeof navigator !== "undefined" && navigator.userAgent.includes("Windows")), local }) : [];
  const [query, setQuery] = useState("");
  const looked = useEditors(!!dir && editors === undefined);
  const outside = dir ? (editors ?? looked) : [];
  const [openError, setOpenError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const { top, more: folded } = agentRows(agents, defaultId);
  const found = searchAgents(agents, query);
  const shown = found ?? (more ? [...top, ...folded] : top);
  const installed = top.length + folded.length;
  const terminalRow = onTerminal && (found === null ? !query.trim() || query.length > MAX_SEARCH : wantsTerminal(query));
  const bound = useLabel("tab.newAgent").length > 0;
  // UX audit F3: Enter in the search box starts nothing while the agent search has failed (the rows are disabled too).
  const first = () => (shown[0] ? !busy && !pass?.error && onPick(shown[0]) : terminalRow && onTerminal?.());
  // UX audit F1: Esc closes the menu wherever focus is (a short list has no search box), and focus goes in on open and back on close.
  const menuBox = useRef<HTMLDivElement>(null);
  // The opener is whatever had focus when the menu first rendered, before the search box's autoFocus takes it.
  const opener = useRef((typeof document === "undefined" ? null : document.activeElement) as HTMLElement | null);
  // A search or entry box that holds text lets Esc through to its own handler, which clears it; the next Esc closes the menu.
  const typing = () => {
    const el = document.activeElement;
    return el instanceof HTMLInputElement && !!menuBox.current?.contains(el) && el.value !== "";
  };
  useEffect(() => watchEscape(window, onClose, () => !typing()), [onClose]);
  // Arrow keys, Home and End walk the enabled rows (the search box keeps its own arrows for text).
  const arrows = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const rows = [...(menuBox.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
    const to = menuStep(rows.length, rows.indexOf(document.activeElement as HTMLElement), e.key);
    if (to === null) return;
    e.preventDefault();
    rows[to]?.focus();
  };
  useEffect(() => {
    if (!menuBox.current?.contains(opener.current) && !menuBox.current?.querySelector("input")) menuBox.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    // Only when focus was lost with the menu: a chooser the menu just opened keeps the focus it took.
    return () =>
      queueMicrotask(() => {
        const a = document.activeElement;
        if (!a || a === document.body) void restoreFocus(opener.current, (sel) => document.querySelector<HTMLElement>(sel));
      });
  }, []);
  // With no default the new-agent shortcut opens the first agent listed (SET-027).
  const opens = shown.find((a) => a.id === defaultId) ?? (defaultId === "" ? shown[0] : undefined);
  return (
    <>
      <div className="menu-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="menu" role="menu" aria-label="New session" style={style} ref={menuBox} onKeyDown={arrows}>
        <div className="menu-title">New session</div>
        {target && (
          <div className="menu-hint">
            Starting in <b>{target}</b>
          </div>
        )}
        {entry && <NewTabEntryBox tabs={entry.tabs} onRun={entry.onRun} />}
        {installed > 3 && (
          <input
            className="field menu-search"
            placeholder="Search agents"
            aria-label="Search agents"
            autoFocus={!entry}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                e.preventDefault();
                setQuery("");
              }
              if (e.key === "Enter") first();
            }}
          />
        )}
        {found !== null && found.length === 0 && !terminalRow && <div className="menu-hint">No installed agent matches.</div>}
        {pass?.error ? (
          <div className="menu-hint warn" role="alert">
            Kolux could not look for agents ({pass.error}). Nothing can start until a search succeeds.
          </div>
        ) : (pass ? !pass.done : agents.length === 0) ? (
          <div className="menu-hint">Looking for agents…</div>
        ) : allOff ? (
          <div className="menu-hint">No agent is switched on. Turn one on in agent settings.</div>
        ) : (
          agents.length > 0 &&
          installed === 0 && <div className="menu-hint">No agent found. Kolux looked for {agents.map((a) => a.program).join(", ")} on the PATH and in the usual install folders.</div>
        )}
        {shown.map((a) => (
          <div className="menu-row" key={a.id}>
            <button role="menuitem" className="menu-item" disabled={busy || !!pass?.error} onClick={() => onPick(a)} title={`Start ${a.name} (${a.path}) in a new pane inside a fresh workspace`}>
              <span className="agent-mark">
                <VendorMark agent={markFor(a.id)} size={13} />
              </span>
              <span className="name">{a.name}</span>
              <span className="muted">{a.path?.split(/[\\/]/).pop()}</span>
              {a.id === defaultId && <span className="menu-chip">Default</span>}
              {a === opens && bound && <Kbd id="tab.newAgent" />}
            </button>
            {a.id !== defaultId && onSetDefault && (
              <button role="menuitem" className="menu-default" title={`Make ${a.name} the default agent`} onClick={() => onSetDefault(a.id)}>
                Set as default
              </button>
            )}
          </div>
        ))}
        {found === null && folded.length > 0 && (
          <button role="menuitem" className="menu-item muted menu-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>
            <span className="name">{more ? "Show fewer agents" : `Show more agents (${folded.length})`}</span>
          </button>
        )}
        {terminalRow && (
          <button role="menuitem" className="menu-item" onClick={onTerminal} title="A plain shell with no agent">
            <span className="agent-mark">
              <VendorMark agent="shell" size={13} />
            </span>
            <span className="name">Blank terminal</span>
          </button>
        )}
        {shellChoices.length > 1 && (
          <>
            <button role="menuitem" className="menu-item" aria-haspopup="menu" aria-expanded={shellsOpen} onClick={() => setShellsOpen((o) => !o)} title="Pick which shell the new terminal runs">
              <span className="agent-mark">
                <VendorMark agent="shell" size={13} />
              </span>
              <span className="name">Terminal…</span>
              <span aria-hidden="true">{shellsOpen ? "▾" : "▸"}</span>
            </button>
            {shellsOpen &&
              shellChoices.map((sh) => (
                <button key={sh.id} role="menuitem" className="menu-item menu-sub" onClick={() => onShell?.(sh)} title={`New terminal: ${sh.program}`}>
                  <span className="agent-mark">
                    <ShellGlyph program={sh.program} />
                  </span>
                  <span className="name">{sh.name}</span>
                </button>
              ))}
          </>
        )}
        {onChoose && (
          <button role="menuitem" className="menu-item" onClick={onChoose} title="Open a pane that asks which AI, model or terminal to run, and how many">
            <span className="agent-mark" aria-hidden="true">
              ?
            </span>
            <span className="name">Choose what to run…</span>
          </button>
        )}
        {dir && outside.length > 0 && (
          <>
            <div className="menu-title">This folder</div>
            {outside.map((e) => (
              <button
                key={`open-${e.id}`}
                role="menuitem"
                className="menu-item"
                title={openTitle(e, dir)}
                onClick={() => {
                  setOpenError(null);
                  openIn(e.id, dir).then(onClose, (err) => setOpenError(String(err)));
                }}
              >
                <span className="agent-mark" aria-hidden="true">
                  {e.id === "vscode" && <AgentMark id="vscode" size={13} />}
                </span>
                <span className="name">{openLabel(e)}</span>
              </button>
            ))}
            {openError && (
              <div className="menu-hint warn" role="alert">
                {openError}
              </div>
            )}
          </>
        )}
        {onManage && (
          <button role="menuitem" className="menu-item muted" onClick={onManage}>
            <span className="name">Manage agents</span>
          </button>
        )}
        {onRefresh && (
          <button role="menuitem" className="menu-item muted" disabled={pass?.looking} onClick={onRefresh} title="Look for installed agent CLIs again">
            {pass?.looking ? "Looking for agents…" : "Refresh agents"}
          </button>
        )}
        <button role="menuitem" className="menu-item muted" onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  );
}
