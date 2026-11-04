// ONB-001..005: the first-run wizard, a four-screen card floating over the dimmed app. WizardView is
// pure; Wizard holds the screen, the Ctrl+Enter chord and the stored progress (onboarding.rs), and
// hands every real action (a session, Add Project) to App through its props.
import { trapTab } from "../chrome/dialogFocus";
import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Ask from "../chrome/Ask";
import { Close, Mark } from "../chrome/icons";
import { ConnectGrid } from "../settings/ConnectGrid";
import { ClaudeCard } from "../settings/SettingsPage";
import CodexCard from "../settings/CodexCard";
import GrokCard from "../settings/GrokCard";
import { t } from "../i18n/lookup";
import { chordFires, escapeLeaves, leaveKey, milestone, SCREENS } from "./firstRun";
import type { AgentInfo } from "../launch/PlusMenu";
import { sessionAgent } from "./sessionAgent";
import { HOOKS_LINE, hooksDefault, recordHooks, recordsHooks } from "./hooksOn";
import { useSettings } from "../settings/useSettings";

const inWizard = (t: EventTarget | null) => t instanceof Element && t.closest(".onb") !== null;

const TILES = [
  { ai: "Claude", doing: "Writing up the findings" },
  { ai: "Codex", doing: "Building the report" },
  { ai: "Grok", doing: "Checking the numbers" },
];
type ViewProps = {
  at: number;
  /** Some AI counts as connected (ONB-003). */
  connected: boolean;
  ping: boolean;
  /** T-608: the status hooks switch beside the one line of consent (on until the user turns it off). */
  hooks: boolean;
  /** 49-ux2: no AI agent is installed, so Open a session is held back with its reason and a Re-check. */
  noAgent?: boolean;
  onRecheck?: () => void;
  cards?: ReactNode;
  onPing: (on: boolean) => void;
  onHooks: (on: boolean) => void;
  onBack: () => void;
  onMain: () => void;
  onSecondary: () => void;
  onPickFolder: () => void;
  onClose?: () => void;
  /** ONB-006: the leave question is showing. */
  leaving?: boolean;
  /** ONB-006: a primary click on the dimmed app around the card. */
  onOutside?: () => void;
  onSkip?: () => void;
  onStay?: () => void;
};

export const mainOff = (at: number, connected: boolean) => at === 1 && !connected;

// 49-ux2: these live here, not in sessionAgent.ts, so the code loaded at start does not carry them.
/** Why the last button picks a folder instead of opening a session while no agent is installed. */
export const NO_AGENT_WHY = "No AI agent is installed yet, so this opens a plain terminal in a folder. Install one in Settings > Agents, then check again.";

/** The wizard's last button: an agent session when one is installed, otherwise a folder (a plain terminal needs no agent). */
export const lastMain = (noAgent: boolean): "Open a session" | "Pick a folder" => (noAgent ? "Pick a folder" : "Open a session");

/** Reads the agent list now and again whenever another view installs or changes one (agents-changed). Returns the stop. */
export function followAgents(
  read: () => Promise<AgentInfo[]>,
  on: (cb: (list: unknown) => void) => Promise<() => void>,
  set: (list: AgentInfo[]) => void,
): () => void {
  let alive = true;
  const load = () => void read().then((l) => alive && set(l), () => {});
  load();
  const off = on((l) => alive && (Array.isArray(l) ? set(l as AgentInfo[]) : load()));
  return () => {
    alive = false;
    void off.then((f) => f());
  };
}

export function WizardView(p: ViewProps) {
  const screen = SCREENS[p.at];
  const main = ["Get started", "Continue", "Continue", lastMain(!!p.noAgent)][p.at];
  const secondary = [null, "I’ll do this later", null, null][p.at];
  return (
    <div className="ask-backdrop onb-backdrop" onMouseDown={(e) => e.button === 0 && e.target === e.currentTarget && p.onOutside?.()}>
      <div className="onb-drag" data-tauri-drag-region />
      <div className="onb" role="dialog" aria-modal="true" aria-label="Get started with Kolux" tabIndex={-1} onKeyDown={trapTab}>
        <div className="onb-head">
          <Mark size={22} />
          <div className="onb-progress">
            {SCREENS.map((s, i) => (
              <span key={s.id} className={i === p.at ? "onb-bar now" : i < p.at ? "onb-bar done" : "onb-bar"} title={s.name} />
            ))}
          </div>
          <span className="onb-count">{`${p.at + 1} of ${SCREENS.length}`}</span>
          {p.onClose && (
            <button className="ib" title="Close" aria-label="Close setup" onClick={p.onClose}>
              <Close />
            </button>
          )}
        </div>
        <h2 className="onb-heading">{screen.heading}</h2>
        <p className="onb-sub">{screen.sub}</p>
        <div className="onb-body">
          {p.at === 0 && (
            <div className="onb-tiles">
              {TILES.map((t) => (
                <div key={t.ai} className="onb-tile" aria-label={`${t.ai} at work`}>
                  <span className="onb-dot" />
                  <span className="onb-ai">{t.ai}</span>
                  <span className="onb-doing">{t.doing}</span>
                </div>
              ))}
            </div>
          )}
          {p.at === 1 && (
            <>
              {p.cards}
              {/* T-608: the one line of consent; moving on from this screen records the switch. */}
              <label className="onb-ping">
                <input type="checkbox" role="switch" checked={p.hooks} onChange={(e) => p.onHooks(e.target.checked)} />
                <span>{HOOKS_LINE}</span>
              </label>
            </>
          )}
          {p.at === 2 && (
            <div className="onb-work">
              <button className="btn onb-folder" onClick={p.onPickFolder}>
                Pick a folder
              </button>
            </div>
          )}
          {p.at === 3 && (
            <>
              <label className="onb-ping">
                <input type="checkbox" role="switch" checked={p.ping} onChange={(e) => p.onPing(e.target.checked)} />
                <span>Tell me whenever an AI finishes</span>
              </label>
            </>
          )}
        </div>
        <div className="onb-foot">
          {secondary && (
            <button className="btn onb-secondary" onClick={p.onSecondary}>
              {secondary}
            </button>
          )}
          {mainOff(p.at, p.connected) && p.at === 1 ? (
            <span className="onb-gap onb-why">{t("onboarding.connect.wait")}</span>
          ) : p.at === 3 && p.noAgent ? (
            <span className="onb-gap onb-why" role="status">
              {NO_AGENT_WHY}{" "}
              <button className="link" onClick={p.onRecheck}>
                Check again
              </button>
            </span>
          ) : (
            <span className="onb-gap" />
          )}
          {p.at > 0 && (
            <button className="btn" onClick={p.onBack}>
              Back
            </button>
          )}
          <button className="btn primary onb-main" disabled={mainOff(p.at, p.connected)} onClick={p.onMain}>
            {main}
            <span className="onb-chord">{/Mac/i.test(globalThis.navigator?.platform ?? "") ? "⌘ ↵" : "Ctrl ↵"}</span>
          </button>
        </div>
      </div>
      {p.leaving && (
        <Ask
          title="Skip setup?"
          body="You can pick setup up again any time: open the help menu in the sidebar and choose Onboarding."
          confirm="Skip"
          cancel="No, keep going"
          safe
          onConfirm={() => p.onSkip?.()}
          onCancel={() => p.onStay?.()}
        />
      )}
    </div>
  );
}

type Props = {
  /** The screen to open on (firstRun.ts openAt). */
  start: number;
  ping: boolean;
  onPing: (on: boolean) => void;
  onSession: () => void;
  onPickFolder: () => void;
  /** ONB-006: Skip in the leave question; the wizard closes as dismissed. */
  onClose: () => void;
};

export default function Wizard(props: Props) {
  const [at, setAt] = useState(props.start);
  const [on, setOn] = useState<Record<string, boolean>>({});
  // ONB-006: Escape, a click on the dimmed app or the corner close asks first; one question at a time.
  const [leaving, setLeaving] = useState(false);
  const connected = Object.values(on).some(Boolean);
  // T-608: what the hooks switch shows is what moving on records, so the two never differ.
  const { settings } = useSettings();
  const [hooks, setHooks] = useState<boolean | null>(null);
  const hooksNow = hooks ?? hooksDefault(settings);
  // ONB-003 / ONB-011: the Connect cards first reporting a connected AI is the first-AI milestone.
  useEffect(() => {
    if (connected) void milestone("aiConnected");
  }, [connected]);
  // 49-ux2: the last button needs an agent to start; the list is read here (the window's own list is App's).
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const readAgents = () => void invoke<AgentInfo[]>("agent_list").then(setAgents, () => {});
  // Read again on every screen and on agents-changed: an agent installed from the Connect screen counts at once.
  useEffect(() => followAgents(() => invoke<AgentInfo[]>("agent_list"), (cb) => listen("agents-changed", (e) => cb(e.payload)), setAgents), [at]);
  const noAgent = agents !== null && sessionAgent(agents, settings) === null;
  const go = (to: number, later = false) => {
    // The stored step is the last screen finished (onboarding.rs); a failed save keeps the wizard going.
    if (to > at) invoke("onboarding_step", { step: to - 1 }).catch(() => {});
    // T-608: a failed record leaves the choice unsaved, so the one-time card asks again (nothing is installed).
    if (recordsHooks(at, to, later)) void recordHooks(hooksNow).catch(() => {});
    setAt(to);
  };
  const main = () => [() => go(1), () => go(2), () => go(3), () => (noAgent ? props.onPickFolder() : props.onSession())][at]();
  const secondary = () => (at === 1 ? go(2, true) : undefined);
  const off = mainOff(at, connected);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (leaveKey(e)) return setLeaving(true);
      if (!chordFires(e, off || leaving)) return;
      e.preventDefault();
      main();
    };
    window.addEventListener("keydown", key);
    const outside = escapeLeaves(window as unknown as Parameters<typeof escapeLeaves>[0], inWizard, () => leaving, () => setLeaving(true));
    return () => {
      window.removeEventListener("keydown", key);
      outside();
    };
  });
  // ONB-006: the dialog is modal, so it takes the focus when it shows (a terminal behind it keeps no keys).
  useEffect(() => {
    document.querySelector<HTMLElement>(".onb")?.focus();
  }, []);
  const [mark] = useState(() => (id: string) => (v: boolean) => setOn((o) => (o[id] === v ? o : { ...o, [id]: v })));
  const [cards] = useState(() => ({ claude: <ClaudeCard onConnected={mark("claude")} />, codex: <CodexCard onConnected={mark("codex")} />, grok: <GrokCard onConnected={mark("grok")} /> }));
  return (
    <WizardView
      at={at}
      connected={connected}
      ping={props.ping}
      hooks={hooksNow}
      noAgent={noAgent}
      onRecheck={readAgents}
      cards={<ConnectGrid cards={cards} />}
      onPing={props.onPing}
      onHooks={setHooks}
      onBack={() => go(at - 1)}
      onMain={main}
      onSecondary={secondary}
      onPickFolder={props.onPickFolder}
      onClose={() => setLeaving(true)}
      leaving={leaving}
      onOutside={() => setLeaving(true)}
      onSkip={() => {
        setLeaving(false);
        props.onClose();
      }}
      onStay={() => setLeaving(false)}
    />
  );
}
