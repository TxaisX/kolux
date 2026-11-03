// ONB-016 / ONB-018: the action panel of a selected Setup Guide step. Multi-task opens the
// new-workspace composer with a short tour, notifications offers sound choices (and on macOS a
// permission card), the default-agent step shows an agent picker with a fold-out list of fallback
// agents, and the setup-script step offers to automate workspace setup. The rules are in actions.ts.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../settings/useSettings";
import { openSettings } from "../settings/pages";
import ConnectGithub from "./ConnectGithub";
import { playTone, readNotifications, SOUND_FIELD, testPlan, VOLUME_FIELD, type Sound } from "../settings/notifications";
import { DEFAULT_AGENT_KEY } from "../launch/agents";
import type { AgentInfo } from "../launch/PlusMenu";
import AgentPicker from "../launch/AgentPicker";
import {
  agentPanel, CARD_WORDS, composeTarget, composerRequests, foldLabel, permissionCard, platformOf, soundPanel,
  type Hands, type Proj,
} from "./actions";
import { markGuide, type GuideRecord, type Place } from "./guide";
import { replayTour } from "./tour";
import { awakeToggle, stopCard, STOP_SKILLS, writerBack } from "./stopCards";
import { SkillStop, UsageStop } from "./LiveStopCards";
import { AWAKE_KEY, HOOKS_OFF_HELP } from "../launch/KeepAwakeCard";
import { WRITER_INSTRUCTIONS_KEY, WRITER_KEY } from "../scm/generate";
import { integrationSteps, readSeenCached, restale, taskSummary, UNSEEN, type Seen } from "./integrations";

/** The first copy of `sel` that is really on screen. */
function shown(sel: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

const domHands: Hands = {
  click: (sel) => {
    const el = shown(sel);
    if (!el) return false;
    if (el.getAttribute("aria-pressed") !== "true") el.click();
    return true;
  },
  onScreen: () => !!shown(".sb-list"),
  wait: (ms) => new Promise((r) => window.setTimeout(r, ms)),
};

/** The window's one composer-request queue: the guide opening or closing voids what is waiting. */
export const composer = composerRequests(domHands);

/** 49-ux2: the line shown when listing projects or opening the composer throws. */
export const failedNote = (e: unknown): string => `Could not start a workspace: ${e instanceof Error ? e.message : String(e)}. Try again.`;

export function MultitaskPanel({ close }: { close: () => void }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null); // 49-ux2: say what went wrong instead of guessing "no git project"
  const go = async () => {
    setBusy(true);
    setFailed(null);
    try {
      const projects = await invoke<Proj[]>("project_list");
      const lists = await Promise.all(projects.map((p) => invoke<Place[]>("workspace_list", { projectId: p.id }).catch(() => null)));
      const active = document.querySelector<HTMLElement>(".sess.sel")?.closest<HTMLElement>("[data-path]")?.dataset.path ?? null;
      const target = composeTarget(projects, lists, active);
      if (target.kind === "ask") return setAsk(true);
      composer.reset();
      close();
      if ((await composer.open(target)) === "opened") replayTour("create");
    } catch (e) {
      setFailed(failedNote(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className="guide-note">A workspace is a copy of your project in its own folder, so a second agent never collides with the first.</p>
      {failed && (
        <p className="guide-note warn" role="alert">
          {failed}
        </p>
      )}
      {ask && (
        <p className="guide-note" role="status">
          Multi-task needs a git project. Add a folder that is a git repository, then come back.{" "}
          <button
            className="btn"
            onClick={() => {
              composer.reset();
              close();
              void composer.open({ kind: "ask" });
            }}
          >
            Add a project
          </button>
        </p>
      )}
      <div className="btn-row">
        <button className="btn primary" onClick={() => void go()} disabled={busy}>
          Create a workspace
        </button>
      </div>
    </>
  );
}

/** 49-ux2: useSettings().save already puts a failed change back; this says so. */
export const SAVE_FAILED = "That change could not be saved, so it was put back.";
export function SaveFailed({ error }: { error: string | null }) {
  return error ? (
    <p className="guide-note warn" role="alert">
      {SAVE_FAILED} {error}
    </p>
  ) : null;
}

export function NotificationsPanel() {
  const { settings, save, error } = useSettings();
  const [result, setResult] = useState<{ shown: boolean; blocked: boolean } | { error: string } | null>(null);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    invoke<GuideRecord>("guide_get").then((g) => setAsked(g.tried.includes("notify-asked")), () => {});
  }, []);
  if (!settings) return null;
  const n = readNotifications(settings);
  const panel = soundPanel(n.sound);
  const test = async () => {
    const plan = testPlan(n);
    try {
      const r = await invoke<{ shown: boolean; blocked: boolean }>("notification_test", { sound: plan.toastSound });
      setResult(r);
      if (r.shown && plan.tone) playTone(plan.tone, plan.gain);
      if (r.blocked && !asked) {
        setAsked(true);
        void markGuide("tried", "notify-asked").catch(() => {});
      }
    } catch (e) {
      setResult({ error: String(e) });
    }
  };
  const card = permissionCard(platformOf(navigator.userAgent), result && !("error" in result) ? result : null, asked);
  return (
    <>
      <SaveFailed error={error} />
      <label className="conn-switch">
        <input type="checkbox" role="switch" checked={n.kinds.notifyOnFinish} onChange={(e) => void save({ notifyOnFinish: e.target.checked })} />
        Tell me when an agent finishes or needs me
      </label>
      <div className="look-select">
        <span>Sound</span>
        <select aria-label="Notification sound" value={n.sound} onChange={(e) => void save({ [SOUND_FIELD]: e.target.value as Sound })}>
          {panel.choices.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      {panel.slider && (
        <div className="look-select">
          <span>Volume</span>
          <input type="range" min={0} max={100} step={5} aria-label="Volume" value={n.volume} onChange={(e) => void save({ [VOLUME_FIELD]: Number(e.target.value) })} />
        </div>
      )}
      {card.show && (
        <p className={`guide-note${card.state === "blocked" ? " warn" : ""}`} role="status" data-permission={card.state}>
          {CARD_WORDS[card.state]}
        </p>
      )}
      {result && "error" in result && <p className="guide-note warn">The test notification could not be shown: {result.error}</p>}
      <div className="btn-row">
        <button className="btn" onClick={() => void test()}>
          Send a test notification
        </button>
      </div>
    </>
  );
}

/** 49-ux2: no agent found: say so, with the two things to do next as buttons. */
export function NoAgent({ onCheck }: { onCheck: () => void }) {
  return (
    <>
      <p className="guide-note" role="status">
        No agent is installed yet. Install Claude Code or Codex, then check again.
      </p>
      <div className="btn-row">
        <button className="btn" onClick={onCheck}>
          Check again
        </button>
        <button className="btn" onClick={() => openSettings("agents")}>
          Open Agents settings
        </button>
      </div>
    </>
  );
}

export function AgentPanel() {
  const { settings, save, error } = useSettings();
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [open, setOpen] = useState(false);
  const offered = useRef(false); // T-579: the install checklist stays on screen once it was offered, so its results can be read
  const look = () => void invoke<AgentInfo[]>("agent_list").then(setAgents, () => setAgents([]));
  useEffect(look, []);
  if (!settings || !agents) return null;
  const p = agentPanel(agents, settings);
  if (p.picker.length === 0 && p.fallback.length === 0) offered.current = true;
  const row = (a: AgentInfo) => (
    <label key={a.id} className="conn-switch">
      <input type="radio" name="default-agent" checked={p.current === a.id} onChange={() => void save({ [DEFAULT_AGENT_KEY]: a.id })} />
      {a.name}
    </label>
  );
  return (
    <>
      <SaveFailed error={error} />
      {offered.current && (agents.length > 0 ? <AgentPicker agents={agents} onChanged={setAgents} level={3} /> : <NoAgent onCheck={look} />)}
      {p.picker.length > 0 && (
        <div role="radiogroup" aria-label="Default agent">
          {p.picker.map(row)}
        </div>
      )}
      {p.fallback.length > 0 && (
        <>
          <button className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {foldLabel(open)}
          </button>
          {open && <div role="radiogroup" aria-label="Fallback agents">{p.fallback.map(row)}</div>}
        </>
      )}
    </>
  );
}

const SNIPPET = "scripts:\n  setup: pnpm install\n";

export function AutomatePanel({ onCheck }: { onCheck: () => void }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const box = useRef<HTMLPreElement>(null);
  const copy = () =>
    navigator.clipboard.writeText(SNIPPET).then(
      () => setCopied(true),
      () => {
        setCopied(false);
        const sel = window.getSelection();
        if (box.current && sel) sel.selectAllChildren(box.current);
      },
    );
  return (
    <>
      <p className="guide-note">
        Put a setup script in a file called <code>kolux.yaml</code> at the top of your repository. Every new workspace runs it before an agent starts.
      </p>
      <pre ref={box} className="guide-code">{SNIPPET}</pre>
      <div className="btn-row">
        <button className="btn" onClick={() => void copy()}>
          Copy the example
        </button>
        <button className="btn" onClick={onCheck}>
          Re-check
        </button>
        {copied === true && <span className="hint">Copied</span>}
        {copied === false && <span className="hint">Copy failed; the example is selected, press Ctrl+C</span>}
      </div>
    </>
  );
}

/** ONB-018: Connect integrations. Two steps, review first; the task step waits behind it (folded, but
 *  openable) and folds into a one-line summary once GitHub answers. Re-check makes the old answers stale. */
export function IntegrationsPanel({ onCheck }: { onCheck: () => void }) {
  const [seen, setSeen] = useState<Seen>(UNSEEN);
  const [looked, setLooked] = useState(false);
  const turn = useRef(0);
  const check = (again: boolean) => {
    const mine = ++turn.current;
    if (again) setSeen(restale);
    // Opening the step is answered from the one-minute memory; Re-check asks gh again.
    readSeenCached(invoke, { force: again }).then((x) => {
      if (mine !== turn.current) return; // a newer check began: this answer is stale
      setSeen(x);
      setLooked(true);
      if (again) onCheck();
    });
  };
  useEffect(() => {
    check(false);
    return () => void (turn.current += 1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const s = integrationSteps(seen);
  return (
    <>
      <section aria-label="Connect a code host for review" data-state={s.review}>
        <p className="guide-group">1. Connect GitHub for review {s.review === "done" && <span className="mark ok">Connected{seen.account ? ` as ${seen.account}` : ""}</span>}</p>
        {s.review !== "done" && <p className="guide-note">{looked ? s.reviewNote : "Checking the GitHub sign-in..."}</p>}
        {s.review !== "done" && <ConnectGithub onExit={() => check(true)} />}
      </section>
      {s.tasks === "done" ? (
        <p className="guide-note" data-state="done">{taskSummary(s, seen.account)}</p>
      ) : (
        <details data-state={s.tasks} open={s.tasks === "active"}>
          <summary>2. Choose where tasks come from</summary>
          <p className="guide-note">{s.tasks === "waiting" ? "Connect GitHub for review first; tasks come from the same sign-in." : s.tasksNote}</p>
        </details>
      )}
      <div className="btn-row">
        <button className="btn" onClick={() => check(true)}>
          Re-check
        </button>
      </div>
    </>
  );
}

/** ONB-024: the setup an Explore Kolux stop carries, right on the stop. Usage and the skill stops
 *  (orchestration, browser) read live facts, so they are their own components (LiveStopCards.tsx). */
export function StopSetup({ stop, taskSource }: { stop: string; taskSource: boolean | null }) {
  const { settings, save, error } = useSettings();
  // The writer mode the switch had before it was turned off, so turning it on again puts that back.
  const before = useRef<string | null>(null);
  // The settings cards draw nothing until the saved settings have arrived (stopCard), so a switch or box
  // is never built from a guessed default and written back over what is saved.
  if (stop === "usage") return <UsageStop />;
  if (STOP_SKILLS[stop]) return <SkillStop stop={stop} />;
  const card = stopCard(stop, { taskSource, settings });
  if (!card) return null;
  if (card.kind !== "provider" && card.kind !== "awake" && card.kind !== "writer") return null;
  if (card.kind === "provider") {
    return (
      <div className="guide-note" data-card="provider" data-connected={card.connected}>
        {card.label}:{" "}
        {card.connected === null
          ? "Checking the GitHub sign-in..."
          : card.connected
            ? "GitHub is connected."
            : "GitHub is not connected."}
        {card.connected === false && <ConnectGithub onExit={() => {}} />}
      </div>
    );
  }
  if (card.kind === "awake") {
    return (
      <div data-card="awake">
        <SaveFailed error={error} />
        <label className="conn-switch">
          <input type="checkbox" role="switch" checked={card.on} onChange={() => void save({ [AWAKE_KEY]: awakeToggle(card.mode) })} />
          Keep this computer awake while an agent is working
        </label>
        {card.hooksOff && (
          <p className="guide-note warn" data-warn="hooks-off" role="note">
            {HOOKS_OFF_HELP}
          </p>
        )}
      </div>
    );
  }
  const saved = settings?.[WRITER_INSTRUCTIONS_KEY];
  const stored = typeof saved === "string" ? saved : "";
  return (
    <div data-card="writer">
      <SaveFailed error={error} />
      <label className="conn-switch">
        <input
          type="checkbox"
          role="switch"
          checked={card.writer.mode !== "off"}
          onChange={(e) => {
            if (!e.target.checked && card.writer.mode !== "off") before.current = card.writer.mode === "agent" ? card.writer.agent : "custom";
            void save({ [WRITER_KEY]: e.target.checked ? writerBack(before.current, card.hasCommand) : "off" });
          }}
        />
        Write the commit message and pull request text with an AI
      </label>
      <textarea
        key={stored}
        className="field"
        aria-label="Instructions for the writer"
        defaultValue={stored}
        placeholder="Optional: how commit messages should read"
        onBlur={(e) => {
          if (e.target.value !== stored) void save({ [WRITER_INSTRUCTIONS_KEY]: e.target.value });
        }}
      />
    </div>
  );
}
