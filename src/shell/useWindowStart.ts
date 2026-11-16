// The window's first reads, moved out of App.tsx as they were (cycle 2, the App.tsx split): app info, the
// agent list (SESS-002), the shells and the settings, and a chooser seat whose agent is gone. Called where they sat, so the window's hook order is unchanged.
import type { WindowState } from "./windowStore";
import type { AppInfo } from "../app-info";
import type { ShellInfo } from "../terminal/newTab";
import { applyWindowBlur } from "../chrome/appLook";
import type { AgentInfo } from "../launch/PlusMenu";
import { clearMissing } from "../launch/seats";
import { applyAppearance, readAppearance } from "../theme";
import { readSettingsInto } from "./settingsRead";
import { onlyWindowState } from "../settings/settingsSync";
import { sharedRead } from "../settings/sharedRead";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

/** Job 68: how long a search for agents may take before the window says so. The error is shown inside
 *  "Kolux could not look for agents (…)", so it is a lower-case part of that sentence. */
export const AGENT_SEARCH_LIMIT_MS = 10_000;
export const AGENT_SEARCH_SLOW = "it took longer than 10 seconds; press Refresh agents to try again";

export function useWindowStart({ agentPass, installedIds, setAgentPass, setAgents, setInfo, setPanes, setSettings, setSettingsRead, setShells }: Pick<WindowState, "agentPass" | "installedIds" | "setAgentPass" | "setAgents" | "setInfo" | "setPanes" | "setSettings" | "setSettingsRead" | "setShells">) {
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
    // PKG-4: the mount read shares a get_settings already in flight; the read after a save (settings-saved) is a real one.
    const readSettings = (load: () => Promise<Record<string, unknown>> = () => invoke<Record<string, unknown>>("get_settings")) =>
      void readSettingsInto(load, (s) => {
          setSettings(s);
          setSettingsRead(true);
          applyAppearance(readAppearance(s));
          applyWindowBlur(s);
          // after-list #39 / row 789: the fallback sentence is told by RecoveryMount now (its own notice, not the single slot the shortcuts file overwrote)
        });
    readSettings(sharedRead);
    // A save of only the window's own state (the layout, the screen: every tab opened) changes nothing read here.
    const off = listen("settings-saved", (e) => onlyWindowState(e?.payload) || (readSettings(), invoke<ShellInfo[]>("shell_list").then(setShells, () => {}))); // SET-026: the chosen default shell leads the list
    return () => {
      void off.then((u) => u()).catch(() => {});
      void offAgents.then((u) => u()).catch(() => {});
    };
  }, []);

  // SESS-002: one refresh is one search. An errored search keeps the last list but blocks
  // launching until a search succeeds; nothing counts as missing before the first one is done.
  function refreshAgents() {
    setAgentPass((p) => ({ ...p, looking: true }));
    // Job 68: a search that never answers ends after AGENT_SEARCH_LIMIT_MS; an answer after that still lands.
    const slow = setTimeout(() => setAgentPass((p) => (p.looking ? { ...p, looking: false, error: AGENT_SEARCH_SLOW } : p)), AGENT_SEARCH_LIMIT_MS);
    invoke<AgentInfo[]>("agent_list").finally(() => clearTimeout(slow)).then(
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

  return {
    refreshAgents,
  };
}
