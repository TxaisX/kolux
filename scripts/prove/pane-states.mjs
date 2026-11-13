// T-566: what each shown terminal pane says after a relaunch. live-T-544.mjs sends this function to the app's page as
// text, (${paneStates.toString()})(document, TERM), the way it sends domRows: it must stay self-contained (no import,
// nothing from this module's scope). The pane key is the pane's own data-key (TerminalPane.tsx, the saved layout key);
// a pane without one reports key null. restored is the text of the restored chip ("restored" / "restored without
// resume"), null when the pane shows none.
//
// The sidebar fallback this reader used to have is gone with the per-pane sidebar rows: the sidebar lists workspaces
// (`.sess[role=button]`, data-path), never one row per pane, so a pane without data-key has no row to be matched to.
// Call it BEFORE any key or click reaches the window: an Escape or a click in the pane clears the chip (TERM-107).
export function paneStates(document, sel) {
  return [...document.querySelectorAll(sel)]
    .filter((e) => e.offsetParent !== null)
    .map((p, i) => {
      const title = (p.getAttribute("aria-label") ?? "").replace(/ pane$/, "");
      return { i, title, key: p.dataset.key ?? null, restored: p.querySelector(".status.restored")?.textContent.trim() ?? null };
    });
}
