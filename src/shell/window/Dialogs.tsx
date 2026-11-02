// Cycle 3 (the WindowView split): everything the window draws over its body, moved out of
// shell/WindowView.tsx as it was: the About panel, the worktree palette, the close question and the
// tab set's, the trust and rename asks, the tab switcher and the tab menu (TERM-044..TERM-049),
// Settings and the Board (T-142). The order they are drawn in is the order the window had.
import { getCurrentWindow } from "@tauri-apps/api/window";
import Ask from "../../chrome/Ask";
import { Kbd } from "../../keys/KeymapContext";
import { reloadAsk } from "../../keys/commands";
import { noteUse } from "../../onboarding/features";
import WorktreePalette, { dirMark, dirMonitoring } from "../../projects/WorktreePalette";
import { workItem } from "../../projects/model";
import { SCM_LINKED_PR_KEY, linkedPrs } from "../../scm/model";
import { TAB_COLORS, setTabColor, tabMenuHead } from "../../terminal/tabColor";
import { splitMenuState } from "../../terminal/tabSplit";
import { tabName } from "../../terminal/tabName";
import { pasteHosts } from "../../tasks/pasteHosts";
import { openInBrowser } from "../../browser/openIn";
import { sameDir } from "../../workspaces";
import { AboutPanel } from "../../lazy/pages";
import { LinkAskHost } from "../../lazy/pages";
import TabSearch from "../TabSearch";
import { quitQuestion } from "../closeAsk";
import { closeRows } from "./tabMenu";
import { useWindow } from "./store";
import { SettingsPage } from "../../lazy/pages";
import { WorkspaceBoard } from "../../lazy/pages";
import { FolderRenameAsk } from "../../lazy/pages";
import { TrustPrompt } from "../../lazy/pages";

export default function WindowDialogs() {
  const {
    palette, projects, paletteItems, rowStates, panes, hook, turn, unreadDirs,
    activeDir, projectOf, setScreen, select, fromItem, projectFor, fromName, setSidebarOpen,
    setCreateName, setCreateRequest, setPalette, settings, setAsking, asking, dropPanes,
    guard, quitAsk, quitting, setQuitAsk, reloadAsking, setReloadAsk, switcher, orderOf,
    titles, tabMenu, pinned, tabColors, setTabMenu, setTabColors, setPinned,
    setRenamingTab, splitTab, closeTab, settingsOpen, setSettingsOpen, settingsAt,
    boardOpen, setBoardOpen, setPanes, setActiveDir, setRefresh, recentDirs,
  } = useWindow();
  return (
    <>
      <AboutPanel />
      {palette && (
        <WorktreePalette
          projects={projects}
          items={paletteItems()}
          prOf={() => null} /* VIEW-043: the Pull requests rows come from prRows */
          atOf={(d) => {
            const row = Object.entries(rowStates).find(([x]) => sameDir(x, d))?.[1];
            // STAT-024: the radio mark when the folder's working panes only watch background work.
            const watching = dirMonitoring(panes.filter((p) => sameDir(p.cwd, d)).map((p) => ({ state: hook[p.key], monitoring: turn[p.key]?.monitoring })));
            const mark = dirMark(row?.state ?? null, [...unreadDirs].some((x) => sameDir(x, d)), watching);
            return mark ? { mark, since: row?.changed ?? 0 } : null;
          }}
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
          onClose={() => setPalette(false)}
          linked={linkedPrs(settings[SCM_LINKED_PR_KEY])}
          hosts={pasteHosts(linkedPrs(settings[SCM_LINKED_PR_KEY]))}
          onItem={openInBrowser}
        />
      )}
      {asking && (
        <Ask
          title={asking.title}
          body={asking.body}
          confirm={asking.confirm ?? "Close tab"}
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
          setPanes((ps) => ps.map((p) => (sameDir(p.cwd, from) ? { ...p, cwd: to } : p)));
          setActiveDir((d) => (sameDir(d, from) ? to : d));
          setRefresh((n) => n + 1);
        }}
      />
      <LinkAskHost />
      <TabSearch tabs={() => paletteItems().filter((i) => i.section === "Open tabs")} />
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
      {tabMenu && (
        // TERM-049 / TERM-044: close items only; the close question (TERM-045) covers the whole set at once.
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
          <div className="menu" role="menu" aria-label="Tab" style={{ top: tabMenu.top, left: tabMenu.left }}>
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
            {closeRows(orderOf(tabMenu.key), tabMenu.key, pinned).map(({ label, which, keys, disabled }) => (
              <button
                key={which}
                role="menuitem"
                className="menu-item"
                disabled={disabled}
                onClick={() => {
                  setTabMenu(null);
                  void closeTab(keys);
                }}
              >
                <span className="name">{label}</span>
                {which === "one" && <Kbd id="tab.close" />}
                {which === "all" && <Kbd id="tab.closeAll" />}
              </button>
            ))}
          </div>
        </>
      )}
      {settingsOpen && <SettingsPage onClose={() => setSettingsOpen(false)} target={settingsAt.target} n={settingsAt.n} active={activeDir ?? ""} />}
      {boardOpen && <WorkspaceBoard onClose={() => setBoardOpen(false)} />}
    </>
  );
}
