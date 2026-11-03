// Cycle 3 (the WindowView split): the pane grid, moved out of shell/WindowView.tsx as it was: the
// lanes on the Board, the empty state, one cell per group (TERM-017), the tab strip with its drag and
// drop (TERM-015, TERM-049, TERM-054) and the pane body beside it (Pane.tsx). The grid's frame follows
// the screen it is on (VIEW-026, TERM-013).
import { CheckCircle, FileCode, Globe, Pin } from "../../chrome/icons";
import VendorMark from "../../chrome/VendorMark";
import { needsYou } from "../../board/chip";
import { folderName } from "../../projects/model";
import { creditedLive, launchedAgent } from "../../status/credit";
import { templateOf } from "../../terminal/dividers";
import { halfOf, zoneOf } from "../../terminal/rearrange";
import { middleClickCloses, orderPinnedFirst } from "../../terminal/pin";
import { tabStyle } from "../../terminal/tabColor";
import { TabBadge, tabName } from "../../terminal/tabName";
import { tabBadge } from "../../terminal/tabs";
import { IDLE, shownAgent } from "../../terminal/shellMarks";
import Ring from "../../usage/Ring";
import { capOn, claudeOf, codexOf, contextFill, meterOf, meterText } from "../../usage/meter";
import NameField from "../../terminal/NameField";
import { sameDir } from "../../workspaces";
import Pane from "./Pane";
import { gridFrame } from "./gridFrame";
import { tabKeyAction, tabStop } from "./tabKeys";
import { menuAnchor } from "./tabMenu";
import { useWindow } from "./store";

export default function Grid() {
  const {
    board, agentsScreen, zoomed, classic, terminals, page, onDividerDown, onDividerMove, endDividerDrag,
    weightsOf, lanes, shown, activeDir, addShell, addChooser, cells, selected, activeOf, dropHint, dragging,
    setDropHint, dropTabOn, dropCellOn, pinned, tabColors, titles, renamingTab, closePane, setFocused,
    setRenamingTab, setTabMenu, liveIds, running, statusOf, unreadPanes, hook, context, settings, plan,
    accountSwitcher, labelOf, tabLabel, renamePane, dirty,
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
      {/* TERM-017: cells are keyed by group and panes by key, and a split only inserts, so a
          pane's terminal is never remounted (never respawned) by a layout change. */}
      {cells.map((c) => {
        // VIEW-015: on the Agents screen the picked session is the one shown, whatever tab its cell had in front.
        const mine = agentsScreen && c.panes.some((p) => p.key === selected);
        const active = mine ? (selected as number) : activeOf(c);
        const order = orderPinnedFirst(c.panes.map((p) => p.key), pinned); // the strip's order: pinned tabs first
        return (
          <div
            key={c.group}
            className="cell"
            data-drop={dropHint?.group === c.group && !dropHint.tab ? dropHint.zone : undefined}
            hidden={agentsScreen ? !mine : !board && (!sameDir(c.panes[0].cwd, activeDir) || (zoomed !== null && c.group !== zoomed))}
            onDragOver={(e) => {
              if (!dragging.current) return;
              e.preventDefault();
              setDropHint({ group: c.group, zone: zoneOf(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect(), !!(e.target as Element).closest?.(".tabs")) });
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHint((h) => (h?.group === c.group ? null : h));
            }}
            onDrop={(e) => {
              const d = dragging.current;
              if (!d) return;
              e.preventDefault();
              const zone = zoneOf(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect(), !!(e.target as Element).closest?.(".tabs"));
              dragging.current = null;
              setDropHint(null);
              if ("tab" in d) dropTabOn(d.tab, { kind: "cell", group: c.group, zone });
              else dropCellOn(d.cell, { group: c.group, zone });
            }}
          >
            {(c.panes.length > 1 || classic) && (
              <div className="tabs" role="tablist" aria-label="Tabs">
                {order
                  .map((k) => c.panes.find((p) => p.key === k) as (typeof c.panes)[number])
                  .map((p) => (
                  <div
                    key={p.key}
                    role="tab"
                    aria-selected={p.key === active}
                    className="tab"
                    tabIndex={tabStop(p.key, active, order)}
                    onKeyDown={(e) => {
                      // Arrows, Home and End move along the strip; keys typed in the rename field or on the close button stay theirs.
                      if (e.target !== e.currentTarget) return;
                      const act = tabKeyAction(e.key, order, p.key);
                      if (!act) return;
                      e.preventDefault();
                      // Manual activation: the arrows only move focus along the strip. Enter or Space brings the tab
                      // forward, and then its pane takes the keyboard (TERM-012), which would end an arrow walk after one step.
                      if ("activate" in act) setFocused(act.activate);
                      else (e.currentTarget.parentElement?.querySelectorAll<HTMLElement>(':scope > [role="tab"]')[order.indexOf(act.focus)])?.focus();
                    }}
                    style={tabStyle(tabColors, p.key)}
                    data-drop={dropHint?.tab === p.key ? dropHint.half : undefined}
                    draggable
                    onDragStart={(e) => {
                      // TERM-054: a tab drags along the strip, onto another cell's strip, or onto an edge band.
                      dragging.current = { tab: p.key };
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", tabName(p, titles));
                    }}
                    onDragEnd={() => (dragging.current = null, setDropHint(null))}
                    onDragOver={(e) => {
                      const d = dragging.current;
                      if (!d || !("tab" in d)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setDropHint({ group: c.group, tab: p.key, half: halfOf(e.clientX, e.currentTarget.getBoundingClientRect()) });
                    }}
                    onDrop={(e) => {
                      const d = dragging.current;
                      if (!d || !("tab" in d)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const half = halfOf(e.clientX, e.currentTarget.getBoundingClientRect());
                      dragging.current = null;
                      setDropHint(null);
                      dropTabOn(d.tab, { kind: "tab", key: p.key, half });
                    }}
                    onMouseDown={() => setFocused(p.key)}
                    onDoubleClick={() => !p.kind && setRenamingTab(p.key)}
                    onContextMenu={(e) => {
                      // TERM-049: the tab menu opens where the pointer is; this click never closes it.
                      e.preventDefault();
                      e.stopPropagation();
                      setTabMenu({ key: p.key, ...menuAnchor(e.clientX, e.clientY, window.innerWidth, window.innerHeight) });
                    }}
                    onAuxClick={(e) => {
                      // TERM-049 / TERM-046: middle-click closes the tab; a pinned tab is exempt.
                      if (e.button !== 1 || !middleClickCloses(p.key, pinned)) return;
                      e.preventDefault();
                      closePane(p.key);
                    }}
                  >
                    {pinned.has(p.key) && (
                      <span className="tab-pin" title="Pinned" data-pinned="true">
                        <Pin size={10} />
                      </span>
                    )}
                    {p.kind === "editor" || p.kind === "preview" || p.kind === "diff" || p.kind === "changes" ? <FileCode size={12} /> : p.kind === "check" ? <CheckCircle size={12} /> : p.kind === "browser" ? <Globe size={12} /> : <VendorMark agent={shownAgent(p.agent, creditedLive(launchedAgent(p), liveIds[p.key] ?? IDLE))} size={12} />}
                    {!p.kind && !p.seats && <TabBadge kind={tabBadge(p.agent, running[p.key], needsYou(statusOf(p)), unreadPanes.has(p.key), hook[p.key])} />}
                    {context[p.key] && <Ring percent={contextFill(context[p.key], capOn(settings))} size={10} title={meterText(meterOf(context[p.key], p.agent, claudeOf(p.agent, p.account, accountSwitcher.active.claude, plan.claude, plan.claudeBy), codexOf(p.agent, p.account, accountSwitcher.active.codex, plan.codex, plan.codexBy), capOn(settings)) ?? {})} />}
                    {renamingTab === p.key ? (
                      <NameField value={tabName(p, titles, labelOf(p), liveIds)} label="Tab name" onSave={(name) => (setRenamingTab(null), renamePane(p.key, name))} onCancel={() => setRenamingTab(null)} />
                    ) : (
                      tabLabel(p)
                    )}
                    {dirty[p.key] && <span className="unsaved" title="Unsaved changes" aria-label="Unsaved changes" />}
                    <button className="tab-x" tabIndex={-1} aria-label={`Close ${tabName(p, titles)}`} onMouseDown={(e) => e.stopPropagation()} onClick={() => closePane(p.key)}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            {c.panes.map((p) => (
              <Pane key={p.key} pane={p} active={active} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
