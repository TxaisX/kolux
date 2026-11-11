// T-543: the window's copy of the settings, moved out of App.tsx as it was. The first read and the
// re-read on "settings-saved" stay in the window's start effect (it also asks app_info, agent_list
// and shell_list, in that order), so the order of those calls is unchanged.
import { useState } from "react";
import { useUsageAlerts } from "../usage/alerts";
import { readLook } from "./general";
import { setOwnFolders } from "../projects/singleFolder";

export function useAppSettings(initial: Record<string, unknown>) {
  const [settings, setSettings] = useState<Record<string, unknown>>(initial);
  const [settingsRead, setSettingsRead] = useState(false); // USAGE-009: no alert before this is true
  useUsageAlerts(settingsRead ? settings : null);
  const classic = readLook(settings) === "classic";
  setOwnFolders(settings); // DT-C250: before anything below draws, so one render never mixes the two ways
  return { settings, setSettings, settingsRead, setSettingsRead, classic };
}
