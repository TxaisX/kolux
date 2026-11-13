// TERM-122: the keep-awake choice for Settings > Agents (On / Agent / Off, Off by default) and the
// status bar item shown while the computer is being kept awake. The Rust watcher (awake.rs) reads
// the same `keepAwake` key; an older plain `true` reads as Agent.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { hooksOn } from "../onboarding/hooksOn";
import { Select } from "../ui/Select";

export const AWAKE_KEY = "keepAwake";
export const AWAKE_MODES = ["off", "agent", "on"] as const;
export type AwakeMode = (typeof AWAKE_MODES)[number];
const LABEL: Record<AwakeMode, string> = { off: "Off", agent: "Agent", on: "On" };

export function awakeMode(settings: Record<string, unknown> | null | undefined): AwakeMode {
  const v = settings?.[AWAKE_KEY];
  if (v === true || v === "agent" || v === "auto") return "agent";
  return v === "on" ? "on" : "off";
}

export const AWAKE_HELP: Record<AwakeMode, string> = {
  off: "The computer sleeps on its usual schedule.",
  agent:
    "The computer stays awake while an agent is working, and sleeps normally once every agent is waiting, blocked or done, or its pane closes. An agent started inside a shell pane that stops without saying so counts for at most 30 minutes after its last word.",
  on: "The computer stays awake while Kolux is open, even with no agent working. On a laptop that uses Modern Standby this can drain the battery; closing the lid may still put it to sleep, and on battery it may sleep a few minutes after its usual sleep timeout.",
};
/** Agent mode counts only panes whose agent reports through the status hooks; with them off it never holds. */
export const HOOKS_OFF_HELP = "Agent mode follows the agent status hooks, which are off: turn them on above, or pick On.";
export const LID_HELP =
  "Closing the lid still follows the system: on Windows, the lid setting in Power Options decides; a Mac sleeps on lid close unless it is plugged in with an outside display; on Linux keep-awake also stops lid-close sleep.";

type Props = { settings: Record<string, unknown>; save: (patch: Record<string, unknown>) => unknown };

export default function KeepAwakeCard({ settings, save }: Props) {
  const mode = awakeMode(settings);
  return (
    <section className="conn-card" data-section="keep-awake">
      <h2 className="conn-name">Keep the computer awake</h2>
      <Select label="Keep the computer awake" value={mode} onChange={(v) => save({ [AWAKE_KEY]: v })} options={AWAKE_MODES.map((m) => ({ value: m, label: LABEL[m] }))} className="field" />
      <p className="conn-detail">{AWAKE_HELP[mode]}</p>
      {mode === "agent" && !hooksOn(settings) ? (
        <p className="conn-detail" data-warn="hooks-off" role="note" style={{ color: "var(--warn)" }}>
          {HOOKS_OFF_HELP}
        </p>
      ) : null}
      <p className="conn-detail">{LID_HELP}</p>
    </section>
  );
}

/** Whether the computer is being kept awake now, re-asked every 5 s. */
export function useKeepAwake(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    let live = true;
    const ask = () => invoke<boolean>("keep_awake_state").then((v) => live && setHeld(!!v), () => {});
    ask();
    const t = setInterval(ask, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return held;
}

/** The status bar item: shown only while the computer is being kept awake. */
export function KeepAwakeItem({ held }: { held: boolean }) {
  return held ? (
    <span className="item" data-item="keep-awake" title="Kolux is keeping the computer awake (Settings > Agents)">
      Awake
    </span>
  ) : null;
}
