// Cycle 3 (the WindowView split): everything the window draws over its body, moved out of
// shell/WindowView.tsx as it was: the About panel, the worktree palette, the close question and the
// tab set's, the trust and rename asks, the tab switcher and the tab menu (TERM-044..TERM-049, in TabMenuView.tsx),
// Settings and the Board (T-142). The order they are drawn in is the order the window had.
import { getCurrentWindow } from "@tauri-apps/api/window";
import Ask from "../../chrome/Ask";
import { reloadAsk } from "../../keys/commands";
import { noteUse } from "../../onboarding/features";
import WorktreePalette from "../../projects/WorktreePalette";
import { paletteAt } from "./paletteAt";
import { workItem } from "../../projects/model";
import { movedTeamFolders, TEAM_WORKTREES_SETTING } from "../../projects/rows";
import { SCM_LINKED_PR_KEY, linkedPrs } from "../../scm/model";
import { tabName } from "../../terminal/tabName";
import { pasteHosts } from "../../tasks/pasteHosts";
import { openExternal } from "../../open/openExternal";
import { sameDir } from "../../workspaces";
import { AboutPanel } from "../../lazy/pages";
import { LinkAskHost } from "../../lazy/pages";
import TabSearch from "../TabSearch";
import { isTabRow } from "../findTab";
import { quitQuestion } from "../closeAsk";
import { deferred } from "../../lazy/deferred";
import { closeConfirmLabel } from "./tabMenuStart";
import { useWindow } from "./store";
import { setPaletteOpen, usePaletteOpen } from "../../chrome/paletteOpen";
import { usePrRows } from "../../scm/usePrRows";
import { SettingsPage } from "../../lazy/pages";
import { WorkspaceBoard } from "../../lazy/pages";
import { FolderRenameAsk } from "../../lazy/pages";
import { TrustPrompt } from "../../lazy/pages";

/** The tab menu (TERM-044..TERM-049) is not in the start bundle (bundle-budget.mjs); it has no placeholder,
 *  so it is read at the first idle moment after start (DT-C230) and the first right-click draws it at once. */
const TabMenu = deferred(() => import("./TabMenuView"), undefined, { prefetch: true });

export default function WindowDialogs() {
  const {
    paletteItems, panes, activeDir, setAsking, asking, dropPanes, guard, quitAsk, quitting, setQuitAsk, reloadAsking,
    setReloadAsk, switcher, titles, tabMenu, settingsOpen, setSettingsOpen, settingsAt, boardOpen, setBoardOpen, setPanes,
    setActiveDir, setRefresh, saveSetting, settingsRef,
  } = useWindow();
  return (
    <>
      <AboutPanel />
      <PaletteHost />
      {asking && (
        <Ask
          title={asking.title}
          body={asking.body}
          confirm={asking.confirm ?? closeConfirmLabel(asking.keys.length)}
          enter
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            dropPanes(asking.keys);
            setAsking(null);
          }}
        />
      )}
      <TrustPrompt />
      {/* STAT-039 (T-110-b): after the first work renamed a branch, asks before the folder follows; a moved folder's panes and the list follow it. */}
      <FolderRenameAsk
        onMoved={(from, to) => {
          setPanes((ps) => ps.map((p) => (sameDir(p.cwd, from) || (p.view != null && sameDir(p.view, from)) ? { ...p, ...(sameDir(p.cwd, from) ? { cwd: to } : {}), ...(p.view != null && sameDir(p.view, from) ? { view: to } : {}) } : p))); // DT-C274: a team grid's folder follows too
          setActiveDir((d) => (sameDir(d, from) ? to : d));
          // DT-C274: the team record follows the move, as the worktree and as the grid it is shown in.
          const team = movedTeamFolders(settingsRef.current[TEAM_WORKTREES_SETTING], from, to);
          if (team) saveSetting(TEAM_WORKTREES_SETTING, team);
          setRefresh((n) => n + 1);
        }}
      />
      <LinkAskHost />
      <TabSearch tabs={() => paletteItems().filter(isTabRow)} />
      {guard.dialog}
      {quitAsk && (
        <Ask
          {...quitQuestion(quitAsk)}
          cancel="Keep working"
          onCancel={() => setQuitAsk(null)}
          onConfirm={() => {
            quitting.current = true;
            setQuitAsk(null);
            void getCurrentWindow().close();
          }}
        />
      )}
      {reloadAsking && (
        <Ask {...reloadAsk(reloadAsking)} cancel="Keep working" onCancel={() => setReloadAsk(null)} onConfirm={() => location.reload()} />
      )}
      {switcher && (
        <div className="menu tab-switcher" role="listbox" aria-label="Switch tab">
          {switcher.list.map((k, i) => {
            const p = panes.find((x) => x.key === k);
            return (
              <div key={k} className={`menu-item${i === switcher.at ? " on" : ""}`} role="option" aria-selected={i === switcher.at}>
                {p ? tabName(p, titles) : `Tab ${k}`}
              </div>
            );
          })}
        </div>
      )}
      {tabMenu && <TabMenu />}
      {settingsOpen && <SettingsPage onClose={() => setSettingsOpen(false)} target={settingsAt.target} n={settingsAt.n} active={activeDir ?? ""} />}
      {boardOpen && <WorkspaceBoard onClose={() => setBoardOpen(false)} />}
    </>
  );
}

/** PROJ-057 / VIEW-037: Go to / Run a command. DT-C270: it is the only surface that reads whether the palette is
 *  open (chrome/paletteOpen.ts) or its pull-request rows (VIEW-043, read only while it is open), so opening it draws
 *  this and nothing else of the window. */
function PaletteHost() {
  const {
    projects, paletteItems, rowStates, panes, hook, turn, unreadPanes, statusOf, running, activeDir, projectOf, setScreen, select, fromItem, projectFor,
    fromName, setSidebarOpen, setCreateName, setCreateRequest, settings, recentDirs,
  } = useWindow();
  const open = usePaletteOpen();
  const prRows = usePrRows(open, (dir) => {
    setScreen("terminals");
    select(dir, null);
  });
  if (!open) return null;
  return (
      <WorktreePalette
        projects={projects}
        items={[...prRows, ...paletteItems()]}
        prOf={() => null} /* VIEW-043: the Pull requests rows come from prRows, above */
        atOf={(d) => paletteAt(d, panes, statusOf, running, unreadPanes, hook, turn, rowStates)}
        recent={recentDirs.current}
        scope={[]}
        hasWorktree={activeDir !== null && projectOf(activeDir) !== null}
        onWorktree={(w) => {
          noteUse("palette");
          setScreen("terminals");
          select(w.path, w.branch ?? null);
        }}
        onCreate={(name, repo) => {
          noteUse("palette");
          setScreen("terminals");
          const item = workItem(name);
          if (item) return fromItem(item);
          const pid = repo ?? projectOf(activeDir) ?? projectFor(null);
          if (pid) return fromName(pid, name);
          setSidebarOpen(true);
          setCreateName(name);
          setCreateRequest((n) => n + 1);
        }}
        onClose={() => setPaletteOpen(false)}
        linked={linkedPrs(settings[SCM_LINKED_PR_KEY])}
        hosts={pasteHosts(linkedPrs(settings[SCM_LINKED_PR_KEY]))}
        onItem={(url: string) => void openExternal(url)}
      />
  );
}
