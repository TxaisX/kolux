// Which screen is up and what follows from it, moved out of App.tsx as it was (cycle 2, the App.tsx split): the
// screen flags, worker task labels (T-050-b), the tab-name rule and its beat (STAT-035), the Inbox and Board
// clock (STAT-050) and full pages (VIEW-009). Called where it sat, so the window's hook order is unchanged.
import type { Pane } from "../App";
import { programWord } from "../launch/PlusMenu";
import { generatedOn, generatedTitle, tabText, tabTip } from "../shell/tabTitle";
import { launchedAgent, launchedName } from "../status/credit";
import { needsBeat, statusTitle, useBeatKeys, useBeatText } from "../status/tabNameRule";
import { tabName } from "../terminal/tabName";
import { showScreen } from "../theme";
import { useEscapeLeaves } from "./fullPage";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { WindowState } from "../shell/windowStore";
import type { PaneActions } from "../terminal/paneActions";

export function useScreens({ classic, hook, leavePage, liveIds, page, panes, ptys, screen, settings, settingsOpen, titles }: Pick<WindowState, "classic" | "hook" | "liveIds" | "page" | "panes" | "ptys" | "screen" | "settings" | "settingsOpen" | "titles"> & Pick<PaneActions, "leavePage">) {
  const terminals = screen === "terminals";
  const board = screen === "board";
  const inbox = screen === "inbox";
  const tower = screen === "tower";
  const floor = screen === "floor";
  const space = screen === "space";
  // T-050-b: an orchestrator-started session with no name or title is named after its worker's task
  // (orchestration worker_labels, by terminal handle), looked up while the Board or
  // the tab strip is open (ORCH-066 / T-129-d: Board rows and generated titles read the same label).
  const [workerNames, setWorkerNames] = useState<Record<string, string>>({});
  const labelOf = (p: Pane) => workerNames[`term-${ptys.current[p.key]}`];
  // TERM-056 / T-258: the tab's text and its hover (the full title); generated titles (off by default) touch only
  // terminal panes without a name of their own.
  // STAT-035 / T-124-b: the tab-name rule on top of the followed title: Kolux names ready and action required for agents whose own titles do not, and one shared beat animates its spinners.
  const ruleOf = (p: Pane) => ({ named: Boolean(labelOf(p) || p.title?.trim()), agent: p.kind ? null : launchedAgent(p), name: launchedName(p) ?? programWord(p.agent), live: liveIds[p.key]?.title, state: hook[p.key] });
  // The beat runs while some tab animates, but its frames re-render only those tab labels (BeatLabel), not the window.
  useBeatKeys(panes.filter((p) => needsBeat(ruleOf(p))).map((p) => p.key));
  const tabLabel = (p: Pane) => {
    const rule = ruleOf(p);
    const shownName = tabName(p, titles, labelOf(p), liveIds);
    const textOf = (full: string) => (p.kind ? full : tabText({ full, own: p.title, on: generatedOn(settings), generated: generatedTitle({ label: labelOf(p), word: p.agent === "shell" ? "Shell" : programWord(p.agent), branch: p.branch, cwd: p.cwd }) }));
    return <BeatLabel animate={needsBeat(rule)} full={(frame) => statusTitle({ ...rule, shown: shownName, frame })} text={textOf} />;
  };
  useEffect(() => {
    if (!board && !terminals) return;
    const look = () => void invoke<Record<string, string>>("worker_labels").then(setWorkerNames, () => {});
    look();
    const t = window.setInterval(look, 5000);
    return () => window.clearInterval(t);
  }, [board, terminals]);
  // STAT-050: the Inbox and the Board read the panes the window already tracks; the clock ticks while one is open.
  const [now, setNow] = useState(Date.now());
  const timed = inbox || board || tower;
  // VIEW-009: a full page fills the workspace area; Show Code (view.code) and an Escape nothing else used leave it.
  // T-146-e: Space is a full page too.
  const fullPage = settingsOpen || (terminals && page !== null) || inbox || tower || floor || space;
  useEscapeLeaves(fullPage && !settingsOpen, leavePage);
  useEffect(() => showScreen(screen, classic), [screen, classic]); // VIEW-006: each screen's own theme
  useEffect(() => {
    if (!timed) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [timed]);
  return {
    terminals, board, inbox, tower, floor, space, workerNames, setWorkerNames, labelOf, ruleOf, tabLabel, now, setNow, timed,
    fullPage,
  };
}

export type Screens = ReturnType<typeof useScreens>;

/** STAT-035: one tab's name; an animating one reads the shared beat itself, so a spinner frame
 *  re-renders this label alone. */
function BeatLabel({ animate, full: fullOf, text }: { animate: boolean; full: (frame: string) => string; text: (full: string) => string }) {
  const full = fullOf(useBeatText(animate));
  const shown = text(full);
  return (
    <span className="tab-name" data-tip={tabTip(full, shown)}>
      {shown}
    </span>
  );
}
