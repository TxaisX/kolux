// T-566: what each shown terminal pane says after a relaunch. live-T-544.mjs sends this function to the app's page as
// text, (${paneStates.toString()})(document, TERM), the way it sends domRows: it must stay self-contained (no import,
// nothing from this module's scope). The pane key is the pane's own data-key (TerminalPane.tsx, the saved layout key);
// a pane without one falls back to its sidebar row (ProjectsPanel pane-row, data-pane) matched by title. restored is
// the text of the restored chip ("restored" / "restored without resume"), null when the pane shows none.
// Call it BEFORE any key or click reaches the window: an Escape or a click in the pane clears the chip (TERM-107).
export function paneStates(document, sel) {
  const rows = [...document.querySelectorAll(".sess.pane-row[data-pane]")];
  return [...document.querySelectorAll(sel)]
    .filter((e) => e.offsetParent !== null)
    .map((p, i) => {
      const title = (p.getAttribute("aria-label") ?? "").replace(/ pane$/, "");
      const row = rows.find((r) => r.title === "Show " + title);
      return { i, title, key: p.dataset.key ?? row?.dataset.pane ?? null, restored: p.querySelector(".status.restored")?.textContent.trim() ?? null };
    });
}
