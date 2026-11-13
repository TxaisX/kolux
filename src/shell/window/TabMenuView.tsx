// The tab menu (TERM-044..TERM-049, TERM-133), loaded on first use rather than at start (scripts/bundle-budget.mjs);
// Dialogs draws it while a menu is open. Change Title, Pin, Tab Color and the splits head it; the close items follow,
// and the close question (TERM-045) covers the whole set at once.
// One session per cell (owner decision 2026-11-12): there is no tab strip, so this is the menu a right-click on a pane
// header opens when the pane has no Pane menu of its own (an editor, a diff, a preview, All Changes, a check, a
// chooser); a terminal's Pane menu opens its colour rows alone (Tab Color…). The close rows measure the grid
// (pin.ts gridOrderOf); Change Title opens the header's name field, and the splits open a shell beside the pane.
// Drawn with the src/ui wrappers (docs/base-ui-migration.md): Base UI gives the arrow keys, Home and End, focus in
// and back, keeping the menu inside the window, closing on a click outside, and disabled rows that stay focusable so
// their reason (the title) can be read; src/ui/layer.ts stops Escape at the menu so it never reaches the pane under
// it. Every row also closes the menu itself before it acts.
import { Kbd } from "../../keys/KeymapContext";
import { MAX_PANES, hasRoom } from "../../terminal/grid";
import { TAB_COLORS, setTabColor, tabMenuHead } from "../../terminal/tabColor";
import { ContextMenu, MenuCheckboxItem, MenuItem } from "../../ui";
import { panesIn, viewOf } from "../../workspaces";
import { closeRows } from "./tabMenu";
import { useWindow } from "./store";

export default function TabMenuView() {
  const { tabMenu, panes, pinned, tabColors, setTabMenu, setTabColors, setPinned, setAskName, splitPane, closeTab, orderOf } = useWindow();
  if (!tabMenu) return null;
  const key = tabMenu.key;
  const p = panes.find((x) => x.key === key);
  const close = () => setTabMenu(null);
  const room = p !== undefined && hasRoom(panesIn(panes, viewOf(p)));
  // A chooser has no name of its own to change, like any pane with a kind (tabMenuHead offers Change Title to terminals).
  const head = tabMenuHead(p?.kind ?? (p?.seats ? "chooser" : undefined), pinned.has(key), room ? { enabled: true, why: null } : { enabled: false, why: `A workspace holds up to ${MAX_PANES} panes.` });
  const rows = tabMenu.colors ? head.filter((i) => i.id === "color") : head;
  return (
    <ContextMenu at={{ x: tabMenu.left, y: tabMenu.top }} onClose={close} label={tabMenu.colors ? "Tab Color" : "Tab"}>
      {/* TERM-048 / TERM-046 / TERM-049: Change Title, Pin, Tab Color and the splits head the menu (terminal/tabColor.ts tabMenuHead). */}
      {rows.map((i) =>
        i.id === "color" ? (
          <div key={i.id} className="menu-colors" role="group" aria-label={i.label}>
            <span className="name">{i.label}</span>
            {TAB_COLORS.map((c) => (
              // A ticked row (menuitemcheckbox), so a screen reader says which colour the pane has; picking one closes the menu.
              <MenuCheckboxItem key={c.id} checked={tabColors[key] === c.id} className={tabColors[key] === c.id ? "swatch on" : "swatch"} title={c.label} onCheckedChange={() => (close(), setTabColors((m) => setTabColor(m, key, c.id)))}>
                <span className="swatch-fill" style={{ background: c.css }} aria-hidden="true" />
                <span className="swatch-name">{c.label}</span>
              </MenuCheckboxItem>
            ))}
            <MenuItem className="swatch none" title="No color" onClick={() => (close(), setTabColors((m) => setTabColor(m, key, null)))}>
              <span aria-hidden="true">×</span>
              <span className="swatch-name">No color</span>
            </MenuItem>
          </div>
        ) : (
          <MenuItem
            key={i.id}
            disabled={"disabled" in i ? i.disabled : false}
            title={"why" in i && i.why ? i.why : undefined}
            onClick={() => {
              if ("disabled" in i && i.disabled) return;
              close();
              if (i.id === "rename") setAskName((m) => ({ ...m, [key]: (m[key] ?? 0) + 1 }));
              else if (i.id === "splitRight" || i.id === "splitDown") splitPane(key, i.id === "splitRight" ? "right" : "down");
              else
                setPinned((s) => {
                  const n = new Set(s);
                  if (n.has(key)) n.delete(key);
                  else n.add(key);
                  return n;
                });
            }}
          >
            <span className="name">{i.label}</span>
            {i.id === "rename" && <Kbd id="tab.rename" />}
          </MenuItem>
        ),
      )}
      {!tabMenu.colors &&
        closeRows(orderOf(key), key, pinned).map(({ label, which, keys, disabled, why }) => (
          <MenuItem key={which} disabled={disabled} title={why} onClick={() => !disabled && (close(), void closeTab(keys))}>
            <span className="name">{label}</span>
            {which === "one" && <Kbd id="tab.close" />}
          </MenuItem>
        ))}
    </ContextMenu>
  );
}
