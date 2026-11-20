// Which screen is up and what follows from it, moved out of App.tsx as it was (cycle 2, the App.tsx split): the
// screen flags, the tab-name rule and its beat (STAT-035), the status clock
// (STAT-050, `now`, no longer ticked here) and Settings as a full page (VIEW-009). Called where it sat, so the window's hook order is unchanged.
import type { Pane } from "../App";
import { programWord } from "../launch/PlusMenu";
import { generatedOn, generatedTitle, tabText, tabTip } from "../shell/tabTitle";
import { launchedAgent, launchedName } from "../status/credit";
import { needsBeat, statusTitle, useBeatKeys, useBeatText } from "../status/tabNameRule";
import { tabName } from "../terminal/tabName";
import { showScreen } from "../theme";
import { useEffect, useState } from "react";
import type { WindowState } from "../shell/windowStore";

export function useScreens({ classic, hook, liveIds, panes, screen, settings, settingsOpen, titles }: Pick<WindowState, "classic" | "hook" | "liveIds" | "panes" | "screen" | "settings" | "settingsOpen" | "titles">) {
  const terminals = screen === "terminals";
  // TERM-056 / T-258: the tab's text and its hover (the full title); generated titles (off by default) touch only
  // terminal panes without a name of their own.
  // STAT-035 / T-124-b: the tab-name rule on top of the followed title: Kolux names ready and action required for agents whose own titles do not, and one shared beat animates its spinners.
  const ruleOf = (p: Pane) => ({ named: Boolean(p.title?.trim()), agent: p.kind ? null : launchedAgent(p), name: launchedName(p) ?? programWord(p.agent), live: liveIds[p.key]?.title, state: hook[p.key] });
  // The beat runs while some tab animates, but its frames re-render only those tab labels (BeatLabel), not the window.
  useBeatKeys(panes.filter((p) => needsBeat(ruleOf(p))).map((p) => p.key));
  const tabLabel = (p: Pane) => {
    const rule = ruleOf(p);
    const shownName = tabName(p, titles, liveIds);
    const textOf = (full: string) => (p.kind ? full : tabText({ full, own: p.title, on: generatedOn(settings), generated: generatedTitle({ word: p.agent === "shell" ? "Shell" : programWord(p.agent), branch: p.branch, cwd: p.cwd }) }));
    return <BeatLabel animate={needsBeat(rule)} full={(frame) => statusTitle({ ...rule, shown: shownName, frame })} text={textOf} />;
  };
  // STAT-050: the clock the status chips read; no screen needs it to tick now.
  const [now, setNow] = useState(Date.now());
  // VIEW-009: Settings is the one full page left; it fills the workspace area.
  const fullPage = settingsOpen;
  useEffect(() => showScreen(screen, classic), [screen, classic]); // VIEW-006: each screen's own theme
  return {
    terminals, ruleOf, tabLabel, now, setNow,
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
