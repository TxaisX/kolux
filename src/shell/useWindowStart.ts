// The window's first reads, moved out of App.tsx as they were (cycle 2, the App.tsx split): app info, the
// agent list (SESS-002), the shells and the settings, a chooser seat whose agent is gone, and pages asked
// for in the built-in browser (GIT-036). Called where they sat, so the window's hook order is unchanged.
import type { WindowState } from "./windowStore";
import type { AppInfo } from "../app-info";
import { OPEN_IN_BROWSER, openDetail, type OpenInBrowser } from "../browser/openIn";
import type { ShellInfo } from "../chrome/LayoutStrip";
import { applyWindowBlur } from "../chrome/appLook";
import type { AgentInfo } from "../launch/PlusMenu";
import { clearMissing } from "../launch/seats";
import { groupOf } from "../terminal/grid";
import { applyAppearance, readAppearance } from "../theme";
import { readSettingsInto } from "./settingsRead";
import { sameDir } from "../workspaces";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

export function useWindowStart({ activeDir, agentPass, focused, installedIds, nextKey, panes, setAgentPass, setAgents, setFocused, setInfo, setPanes, setSettings, setSettingsRead, setShells }: Pick<WindowState, "activeDir" | "agentPass" | "focused" | "installedIds" | "nextKey" | "panes" | "setAgentPass" | "setAgents" | "setFocused" | "setInfo" | "setPanes" | "setSettings" | "setSettingsRead" | "setShells">) {
  useEffect(() => {
    invoke<AppInfo>("app_info").then(setInfo).catch(() => setInfo(null));
    refreshAgents();
    invoke<ShellInfo[]>("shell_list").then(setShells, () => setShells([]));
    // SET-027: Refresh on the Agents page looks again; the window takes the list it found, so
    // one refresh is one search (SESS-002).
    // An install that finished (SET-026) says so with no list: the window searches once for everyone.
    const offAgents = listen<AgentInfo[] | null>("agents-changed", (e) => {
      if (!Array.isArray(e.payload)) return refreshAgents();
      setAgents(e.payload);
      setAgentPass({ looking: false, done: true, error: null });
    });
    // SET-001: the saved look is put on the window every time the settings are read.
    const readSettings = () =>
      void readSettingsInto(() => invoke<Record<string, unknown>>("get_settings"), (s) => {
          setSettings(s);
          setSettingsRead(true);
          applyAppearance(readAppearance(s));
          applyWindowBlur(s);
          // after-list #39 / row 789: the fallback sentence is told by RecoveryMount now (its own notice, not the single slot the shortcuts file overwrote)
        });
    readSettings();
    const off = listen("settings-saved", () => (readSettings(), invoke<ShellInfo[]>("shell_list").then(setShells, () => {}))); // SET-026: the chosen default shell leads the list
    return () => {
      void off.then((u) => u()).catch(() => {});
      void offAgents.then((u) => u()).catch(() => {});
    };
  }, []);

  // SESS-002: one refresh is one search. An errored search keeps the last list but blocks
  // launching until a search succeeds; nothing counts as missing before the first one is done.
  function refreshAgents() {
    setAgentPass((p) => ({ ...p, looking: true }));
    invoke<AgentInfo[]>("agent_list").then(
      (list) => {
        setAgents(list);
        setAgentPass({ looking: false, done: true, error: null });
        void emit("agents-changed", list).catch(() => {});
      },
      (err) => setAgentPass((p) => ({ ...p, looking: false, error: String(err) || "the search failed" })),
    );
  }
  // SESS-002 / SESS-003: once a search is done, a seat whose agent is gone (or switched off) is
  // emptied for good, never refilled when the agent comes back.
  const offeredKey = installedIds.join(",");
  useEffect(() => {
    if (!agentPass.done || agentPass.error) return;
    setPanes((ps) => {
      let changed = false;
      const next = ps.map((p) => {
        if (!p.seats) return p;
        const seats = clearMissing(p.seats, installedIds);
        if (seats.every((s, i) => s === p.seats![i])) return p;
        changed = true;
        return { ...p, seats };
      });
      return changed ? next : ps;
    });
  }, [agentPass, offeredKey]);

  // GIT-036: a page asked for in the built-in browser opens as a new tab in the focused split.
  useEffect(() => {
    const show = (e: Event) => {
      // T-242 (BROW-067): the Preview button names its tab "Preview host:port".
      const { url, title } = openDetail((e as CustomEvent<OpenInBrowser>).detail);
      const here = panes.find((p) => p.key === focused && sameDir(p.cwd, activeDir));
      const key = nextKey.current++;
      setPanes((ps) => [...ps, { key, cwd: activeDir, branch: here?.branch ?? null, group: here ? groupOf(here) : undefined, agent: "shell", program: null, args: [], kind: "browser", url, title }]);
      setFocused(key);
    };
    window.addEventListener(OPEN_IN_BROWSER, show);
    return () => window.removeEventListener(OPEN_IN_BROWSER, show);
  }, [panes, focused, activeDir]);
  return {
    refreshAgents,
  };
}
