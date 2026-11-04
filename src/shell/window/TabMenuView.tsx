// The tab right-click menu (TERM-044..TERM-049), moved out of Dialogs.tsx so its code loads on first use rather than
// at start (scripts/bundle-budget.mjs); Dialogs draws it while a menu is open. Change Title, Pin, Tab Color and the
// splits head it; the close items follow, and the close question (TERM-045) covers the whole set at once.
import { useRef } from "react";
import { Kbd } from "../../keys/KeymapContext";
import { TAB_COLORS, setTabColor, tabMenuHead } from "../../terminal/tabColor";
import { splitMenuState } from "../../terminal/tabSplit";
import { closeRows } from "./tabMenu";
import { useTabMenuKeys } from "./tabMenuKeys";
import { useWindow } from "./store";

export default function TabMenuView() {
  const { tabMenu, panes, pinned, tabColors, setTabMenu, setTabColors, setPinned, setRenamingTab, splitTab, closeTab, orderOf } = useWindow();
  const tabBox = useRef<HTMLDivElement>(null);
  useTabMenuKeys(tabMenu !== null, tabBox, () => setTabMenu(null)); // focus, arrows and Escape for the tab menu
  if (!tabMenu) return null;
  return (
    <>
      <div
        className="menu-backdrop"
        aria-hidden="true"
        onClick={() => setTabMenu(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          setTabMenu(null);
        }}
      />
      <div ref={tabBox} className="menu" role="menu" aria-label="Tab" style={{ top: tabMenu.top, left: tabMenu.left }}>
        {/* TERM-048 / TERM-046 / TERM-049: Change Title, Pin, Tab Color and the splits head the menu (terminal/tabColor.ts tabMenuHead). */}
        {tabMenuHead(panes.find((p) => p.key === tabMenu.key)?.kind, pinned.has(tabMenu.key), splitMenuState(panes, tabMenu.key)).map((i) =>
          i.id === "color" ? (
            <div key={i.id} className="menu-colors" role="group" aria-label={i.label}>
              <span className="name">{i.label}</span>
              {TAB_COLORS.map((c) => (
                <button
                  key={c.id}
                  role="menuitemradio"
                  aria-checked={tabColors[tabMenu.key] === c.id}
                  className="swatch"
                  style={{ background: c.css }}
                  title={c.label}
                  aria-label={c.label}
                  onClick={() => (setTabMenu(null), setTabColors((m) => setTabColor(m, tabMenu.key, c.id)))}
                />
              ))}
              <button role="menuitem" className="swatch none" title="No color" aria-label="No color" onClick={() => (setTabMenu(null), setTabColors((m) => setTabColor(m, tabMenu.key, null)))}>
                ×
              </button>
            </div>
          ) : (
            <button
              key={i.id}
              role="menuitem"
              className="menu-item"
              disabled={"disabled" in i ? i.disabled : false}
              title={"why" in i && i.why ? i.why : undefined}
              onClick={() => {
                const key = tabMenu.key;
                setTabMenu(null);
                if (i.id === "rename") setRenamingTab(key);
                else if (i.id === "splitRight" || i.id === "splitDown") splitTab(key, i.id === "splitRight" ? "right" : "down");
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
            </button>
          ),
        )}
        {closeRows(orderOf(tabMenu.key), tabMenu.key, pinned).map(({ label, which, keys, disabled, why }) => (
          <button
            key={which}
            role="menuitem"
            className="menu-item"
            aria-disabled={disabled || undefined}
            title={why}
            onClick={() => {
              if (disabled) return;
              setTabMenu(null);
              void closeTab(keys);
            }}
          >
            <span className="name">{label}</span>
            {/* C01-R4-01: the chord on `tab.closeAll` is the editor's close-all, so it no longer
                stands for this row, which still closes every tab in the strip. */}
            {which === "one" && <Kbd id="tab.close" />}
          </button>
        ))}
      </div>
    </>
  );
}
