// Cycle 3 (the WindowView split): the chooser pane, in a grid cell (SESS-007) or as the New session
// page (SESS-018), moved out of shell/WindowView.tsx as it was. Both places build it here, so the
// seat defaults, the offered lineup and the saved shapes cannot drift apart.
import { chooserClosable } from "../../launch/chooserClosable";
import { seatDefault } from "../../launch/defaultSeat";
import { defaultAgentId } from "../../launch/agents";
import { SAVED_SHAPES_KEY, applyLineup, defaultCopies, offeredLineup, restoreShape, type SavedShape, type Seat } from "../../launch/seats";
import { panesIn } from "../../workspaces";
import { cellsOf } from "../../terminal/grid";
import { ADD_PROJECT } from "../../onboarding/firstRun";
import { addFolderVia, recentFirst, type StartSheet } from "../../launch/startForm";
import { addFolderHands } from "./sidebarScreens";
import { useWindow } from "./store";
import { ChooserPane } from "../../lazy/pages";

export default function SeatChooser({ pane: p, hidden, focused, onFocus, onClose, sheetOf = null }: {
  pane: StartSheet & { seats: Seat[] };
  hidden: boolean;
  focused: boolean;
  onFocus: () => void;
  onClose: () => void;
  /** SESS-018: the project and folder the full-page sheet is over, when it is a sheet. */
  sheetOf?: { project: string; path: string } | null;
}) {
  const {
    agents, agentPass, refreshAgents, settings, installedIds, lineupsOf, projectOf, projectFor, setChooser,
    setSeats, startSeats, startAcross, inGitFor, launching, panes, activeDir, saveSetting, projects, recentDirs,
    screen, setScreen, setSidebarOpen,
  } = useWindow();
  // Start form C: the folders row, on the sheet only. Each folder's grid size counts toward its MAX_PANES.
  const folders = sheetOf
    ? {
        rows: recentFirst(projects, recentDirs.current).map((x) => ({ id: x.id, name: x.name, path: x.path })),
        ticked: p.folders ?? [],
        used: Object.fromEntries(projects.map((x) => [x.id, cellsOf(panesIn(panes, x.path)).length])),
        onTick: (ids: string[]) => setChooser(p.key, { folders: ids }),
        // the sidebar's Add project dialog; with the sidebar hidden or on Agents, its panel is shown first (job 13 F1)
        onAdd: () =>
          void addFolderVia({ ...addFolderHands(setSidebarOpen, screen, setScreen), fire: () => window.dispatchEvent(new CustomEvent(ADD_PROJECT)) }),
      }
    : null;
  return (
    <ChooserPane
      key={p.key}
      number={p.key}
      hidden={hidden}
      focused={focused}
      onFocus={onFocus}
      agents={agents}
      detecting={!agentPass.done}
      seats={p.seats}
      pass={agentPass}
      onRefresh={refreshAgents}
      seatDefault={seatDefault(settings)}
      defaultAgent={defaultAgentId(settings)}
      lastLineup={offeredLineup(lineupsOf(settings)[projectOf(p.cwd) ?? projectFor(null) ?? ""], installedIds)}
      onUseLineup={() => {
        const l = offeredLineup(lineupsOf(settings)[projectOf(p.cwd) ?? projectFor(null) ?? ""], installedIds);
        if (l) setChooser(p.key, { ...applyLineup(l, installedIds), copies: l.copies });
      }}
      onSeats={(s) => setSeats(p.key, s)}
      shape={p.shape ?? "custom"}
      onLineup={(shape, s) => setChooser(p.key, { shape, seats: s })}
      task={p.task ?? ""}
      onTask={(task) => setChooser(p.key, { task })}
      onStart={(s) => void (sheetOf ? startAcross(p, s) : startSeats(p.key, s))}
      copies={p.copies ?? defaultCopies(p.seats.length, inGitFor(p))}
      inGit={inGitFor(p)}
      onCopies={(copies) => setChooser(p.key, { copies })}
      busy={launching}
      closable={chooserClosable(panesIn(panes, activeDir).length, sheetOf !== null)}
      onClose={onClose}
      sheet={sheetOf}
      folders={folders}
      keepLabel={p.atOpen ? "Keep what was open" : "Cancel"}
      saved={Array.isArray(settings[SAVED_SHAPES_KEY]) ? (settings[SAVED_SHAPES_KEY] as SavedShape[]) : []}
      onSaved={(list) => saveSetting(SAVED_SHAPES_KEY, list)}
      onPickSaved={(t) => setChooser(p.key, { shape: "custom", seats: restoreShape(t, installedIds), task: t.task ?? "", copies: t.copies })}
    />
  );
}
