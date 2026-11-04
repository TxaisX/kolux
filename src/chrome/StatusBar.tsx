// The 24 px status bar (DESIGN.md section 8): right-aligned "On" dot, the app's memory, the
// number of terminals and the agent count. Memory is asked of the Rust side every two seconds;
// clicking it opens the Resource Manager (APP-054). VIEW-096: right-click the bar to choose its
// items or hide it; Settings > Appearance brings it back.
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatMemory } from "../status/memory";
import ResourceManager from "../status/ResourceManager";
import { Chip, Cup, Plug, Shell } from "./icons";
import { STATUS_ITEMS } from "./statusItems";
import { useMenuFocus } from "./dialogFocus";
import { BAR_EVENT, SHOW_EVENT, currentBar } from "../update/UpdateCenter";
import { KeepAwakeItem, useKeepAwake } from "../launch/KeepAwakeCard";
import PortsItem from "../ports/PortsItem";
import SkillBarItem from "../skills/SkillBarItem";

type Props = {
  terminals: number;
  agents?: number;
  names?: () => Record<number, string>;
  workspaces?: string[];
  /** VIEW-078: the active workspace folder whose listening ports the Ports item shows. */
  active?: string | null;
  hidden?: string[];
  onToggle?: (id: string) => void;
  onHideBar?: () => void;
  /** T-543-b: the agent status hooks switch as saved; null until the settings are read, and then nothing is shown. */
  hooks?: boolean | null;
  /** T-153-e / FIX-2: whether the window has finished restoring its panes; the Resource Manager offers no session cleanup until then. */
  loaded?: () => boolean;
};

export default function StatusBar({ terminals, agents = 0, names = () => ({}), workspaces = [], active = null, hidden = [], onToggle, onHideBar, hooks = null, loaded }: Props) {
  const [memory, setMemory] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<{ left: number; bottom: number } | null>(null);
  const menuBox = useRef<HTMLDivElement>(null);
  // The right-click menu takes focus, answers the arrow keys and Escape, and gives focus back.
  useMenuFocus(menuBox, menu !== null, () => setMenu(null));
  const shows = (id: string) => !hidden.includes(id);
  // TERM-122: shown only while the computer is being kept awake.
  const awake = useKeepAwake();
  // VIEW-100: the app update item, while an update is offered, downloading, ready or failed.
  const [update, setUpdate] = useState(currentBar);
  useEffect(() => {
    const on = () => setUpdate(currentBar());
    window.addEventListener(BAR_EVENT, on);
    return () => window.removeEventListener(BAR_EVENT, on);
  }, []);
  useEffect(() => {
    if (!shows("memory")) return;
    let live = true;
    const tick = () => invoke<number | null>("process_memory").then((b) => live && setMemory(b)).catch(() => {});
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [hidden.includes("memory")]);
  // VIEW-096: a right-click inside an item's popover belongs to the popover, not to the bar.
  const onContextMenu = (e: MouseEvent) => {
    if ((e.target as Element).closest?.(".menu")) return;
    e.preventDefault();
    setMenu({ left: Math.min(e.clientX, window.innerWidth - 240), bottom: Math.max(8, window.innerHeight - e.clientY + 4) });
  };
  return (
    <footer className="statusbar" onContextMenu={onContextMenu}>
      {update && (
        <button className={`item upd-item ${update.tone}`} title={update.title} onClick={() => window.dispatchEvent(new Event(SHOW_EVENT))}>
          {update.tone !== "info" && <span className="dot" />}
          {update.text}
        </button>
      )}
      {/* SKILL-027 / VIEW-100: a running skill update with its count, then a check that fades or a failure that stays until clicked. */}
      <SkillBarItem />
      {shows("hooks") && hooks !== null && (
        <span className="item" title={`Agent status hooks are ${hooks ? "on" : "off"} (Settings > Agents)`}>
          <Cup size={12} />
          {hooks ? "On" : "Off"}
          {hooks && <span className="on" />}
        </span>
      )}
      {shows("memory") && (
        <button className="item res-open" title="Memory this app holds right now. Click for every session's memory and CPU" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Chip size={12} />
          {formatMemory(memory)}
        </button>
      )}
      {open && shows("memory") && <ResourceManager names={names} workspaces={workspaces} loaded={loaded} onClose={() => setOpen(false)} />}
      {shows("memory") && (shows("terminals") || shows("agents")) && <span className="sep">·</span>}
      {shows("terminals") && (
        <span className="item" title="Terminals running">
          <Shell size={12} />
          {terminals}
        </span>
      )}
      {shows("agents") && (
        <span className="item" title="Agents running">
          <Plug size={12} />
          {agents}
        </span>
      )}
      {shows("ports") && <PortsItem active={active} workspaces={workspaces} />}
      {shows("awake") && <KeepAwakeItem held={awake} />}
      {menu && (
        <>
          <div className="menu-backdrop" onClick={() => setMenu(null)} onContextMenu={(e) => (e.preventDefault(), setMenu(null))} aria-hidden="true" />
          <div ref={menuBox} className="menu status-menu" role="menu" aria-label="Status bar items" style={menu}>
            <div className="menu-title">Status bar</div>
            {STATUS_ITEMS.map((i) => (
              <button key={i.id} role="menuitemcheckbox" aria-checked={shows(i.id)} className="menu-item" onClick={() => onToggle?.(i.id)}>
                <span className="agent-mark">{shows(i.id) ? "✓" : ""}</span>
                <span className="name">{i.label}</span>
              </button>
            ))}
            <button
              role="menuitem"
              className="menu-item muted"
              title="Settings > Appearance shows it again"
              onClick={() => {
                setMenu(null);
                onHideBar?.();
              }}
            >
              <span className="agent-mark" />
              <span className="name">Hide status bar</span>
            </button>
          </div>
        </>
      )}
    </footer>
  );
}
