// The 24 px status bar (DESIGN.md section 8): right-aligned "On" dot, the app's memory, the
// number of terminals and the agent count. Memory is asked of the Rust side every two seconds;
// clicking it opens the Resource Manager (APP-054). VIEW-096: right-click the bar to choose its
// items or hide it; Settings > Appearance brings it back.
import { useEffect, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatMemory, pollWhileVisible } from "../status/memory";
import { ResourceManager } from "../lazy/menus";
import { Chip, Cup, Plug, Shell } from "./icons";
import { STATUS_ITEMS } from "./statusItems";
import { BAR_EVENT, SHOW_EVENT, currentBar } from "../update/bus";
import { KeepAwakeItem, useKeepAwake } from "../launch/KeepAwakeCard";
import PortsItem from "../ports/PortsItem";
import SkillBarItem from "../skills/SkillBarItem";
import { openSettings } from "../settings/pages";
import { Menu, MenuCheckboxItem, MenuItem, MenuTitle } from "../ui/Menu";

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
  // The right-clicked point; the items menu (src/ui) opens upward from it, takes focus, answers the arrow keys and
  // Escape, and gives focus back.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
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
    // Asked only while the window is visible: a minimised Kolux makes no call every two seconds.
    const stop = pollWhileVisible(tick, 2000);
    return () => {
      live = false;
      stop();
    };
  }, [hidden.includes("memory")]);
  // VIEW-096: a right-click inside an item's popover belongs to the popover, not to the bar.
  const onContextMenu = (e: MouseEvent) => {
    if ((e.target as Element).closest?.(".menu")) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
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
        <button className="item hooks-item" aria-label={`Agent status hooks ${hooks ? "on" : "off"}, open Settings > Agents`} title={`Agent status hooks are ${hooks ? "on" : "off"}. Click to open Settings > Agents`} onClick={() => openSettings("agents", "hooks")}>
          <Cup size={12} />
          {hooks ? "On" : "Off"}
          {hooks && <span className="on" />}
        </button>
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
      {/* A ticked item stays open for the next one; Hide status bar closes it. */}
      <Menu open={menu !== null} onClose={() => setMenu(null)} label="Status bar items" at={menu} side="top" offset={4} className="status-menu">
        <MenuTitle>Status bar</MenuTitle>
        {STATUS_ITEMS.map((i) => (
          <MenuCheckboxItem key={i.id} checked={shows(i.id)} onCheckedChange={() => onToggle?.(i.id)}>
            <span className="agent-mark">{shows(i.id) ? "✓" : ""}</span>
            <span className="name">{i.label}</span>
          </MenuCheckboxItem>
        ))}
        <MenuItem className="menu-item muted" title="Settings > Appearance shows it again" onClick={() => onHideBar?.()}>
          <span className="agent-mark" />
          <span className="name">Hide status bar</span>
        </MenuItem>
      </Menu>
    </footer>
  );
}
