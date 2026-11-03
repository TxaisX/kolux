// Cycle 3 (the WindowView split): the top bar and the four things it does, moved out of
// shell/WindowView.tsx as they were. VIEW-005 / VIEW-011 keep the screen and the page; SET-020 and
// VIEW-011 show the app name and the Automations button only when Settings says so.
import TopBar from "../../chrome/TopBar";
import { chromeShown } from "../../chrome/chromeItems";
import { stepAllowed, travel } from "../../projects/nav";
import { zoomFactor } from "../../settings/zoom";
import { zoomTerm } from "../../theme";
import { useWindow } from "./store";

export default function WindowTopBar() {
  const {
    settings, screen, setScreen, needing, classic, leftWidth, terminals, page, setPage, setPalette,
    installedIds, codex, sidebarOpen, setSidebarOpen, focused, fullPage, right, saveRight, showRight, step,
    hist, stillThere, settingsOpen, setNotice,
  } = useWindow();
  return (
    <TopBar
      appName={chromeShown(settings, "titleBarAppName")}
      automations={
        chromeShown(settings, "automationsButton")
          ? {
              open: terminals && page === "automations",
              onToggle: () => {
                setScreen("terminals");
                setPage((p) => (terminals && p === "automations" ? null : "automations"));
              },
            }
          : undefined
      }
      screen={screen}
      needsYou={needing}
      classic={classic}
      sidebarWidth={leftWidth}
      appMenu
      onNotice={setNotice}
      uiZoom={zoomFactor()}
      onScreen={(s) => {
        if (s === "terminals") setPage(null); // W3 F3 (T-693, VIEW-009): Terminals leaves a full page (Automations, Tasks)
        setScreen(s);
      }}
      installed={installedIds} codexAccount={codex.accounts.length > 0} onSearch={() => setPalette(true)} onBack={!stepAllowed(screen === "terminals", settingsOpen) || travel(hist, -1, stillThere) === null ? undefined : () => step(-1)} onForward={!stepAllowed(screen === "terminals", settingsOpen) || travel(hist, 1, stillThere) === null ? undefined : () => step(1)} sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((o) => !o)} onZoom={(how) => zoomTerm(focused, how)} fullPage={fullPage} rightOpen={terminals && right.open} onToggleRight={() => (terminals && right.open ? saveRight({ open: false }) : showRight(right.tab))} />
  );
}
