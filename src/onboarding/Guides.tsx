// ONB-014 Setup Guide, ONB-022 Explore Kolux and ONB-027 / ONB-028 startup tips. Mounted once in
// the window; the help menu and the tips open the guides through openGuide / openExplore.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Rect } from "./tour";
import { trapTab } from "../chrome/dialogFocus";
import { invoke } from "@tauri-apps/api/core";
import { Close, EyeOff } from "../chrome/icons";
import { useKeymap } from "../keys/KeymapContext";
import { defaultsOnly, labelOf } from "../keys/keymap";
import "./onboarding.css";
import { useSettings } from "../settings/useSettings";
import { probeSetup } from "../settings/setupProbe";
import Tours from "./Tours";
import CliSetup, { useCliCaps } from "./CliSetup";
import Demo from "./Demo";
import StarPrompt from "./StarPrompt";
import { AgentPanel, AutomatePanel, composer, IntegrationsPanel, MultitaskPanel, NotificationsPanel, StopSetup } from "./StepPanels";
import { integrationSteps, readSeenCached, taskSourceOf } from "./integrations";
import { guideOpenChanged } from "./actions";
import { MOVED, splitCredit } from "./moved";
import { askHooks, HOOKS_LINE, hooksDefault, recordHooks } from "./hooksOn";
import { closeOnSettings, stepAside, useDialogFocus } from "./dialogFocus";
import { submitKeys } from "./submitKeys";
import { defaultAgentId } from "../launch/agents";
import {
  caps, demoFrames, doneFrom, paletteKeys, doneId, firstOpen, forward, latest, markGuide, moveOn, nextTip, OPEN_EXPLORE, OPEN_GUIDE, guideClosed, PAGE_SHOWN, railKey, ring, STEPS, stopDone, stopOf, TWO_REPOS, withRecord, words, workflowDone, WORKFLOWS,
  checklistHidden, HIDE_PATCH, legacyProfile, type At, type CliStatus, type Facts, type GuideRecord, type Place, type Setup, type StepId, type TipId,
} from "./guide";

type Scan = { skills: { name: string; source: string }[] };

type Read = Omit<Facts, "cli">;
const UNREAD: Read = { workspaces: null, gitProjects: null, pageShown: false, integrations: null, notifications: null, agent: null, setupScript: null };

/** ONB-015: reads what each step stands for. A project counts as git when its workspace list
 *  reads; the lasting count of git projects is kept on the profile once it reaches two. Resolves
 *  once every read has answered (VIEW-114: the sidebar entry waits for that, so it never flashes),
 *  with the setup-script answer (null when it was never asked). */
async function readFacts(check: ReturnType<typeof latest<boolean>>, put: (f: Partial<Read>) => void, alive: () => boolean): Promise<boolean | null> {
  const [settings, g] = await Promise.all([invoke<Record<string, unknown>>("get_settings").catch(() => null), invoke<GuideRecord>("guide_get").catch(() => null)]);
  if (!alive()) return null;
  put({ notifications: settings ? settings.notifyOnFinish !== false : null, agent: settings ? defaultAgentId(settings) : null, pageShown: !!g?.tried.includes(PAGE_SHOWN), legacy: legacyProfile(settings, g?.tried ?? null), splitCredit: splitCredit(g?.tried, g?.features) });
  put({ integrations: "checking" });
  // ONB-018: connected means signed in and the token accepted, not only a cached sign-in.
  const gh = readSeenCached(invoke).then(
    (x) => void (alive() && put({ integrations: integrationSteps(x).review === "done" ? "connected" : "none" })),
    () => void (alive() && put({ integrations: null })),
  );
  const projects = await invoke<{ path: string; id: string }[]>("project_list").catch(() => null);
  if (!alive() || !projects) return gh.then(() => null);
  const lists = await Promise.all(projects.map((p) => invoke<Place[]>("workspace_list", { projectId: p.id }).catch(() => null)));
  if (!alive()) return null;
  const git = projects.filter((_, i) => lists[i] !== null);
  const twoBefore = !!g?.tried.includes(TWO_REPOS);
  if (git.length >= 2 && !twoBefore) markGuide("tried", TWO_REPOS).catch(() => {});
  put({ workspaces: lists.filter((l): l is Place[] => l !== null), gitProjects: Math.max(git.length, twoBefore ? 2 : 0) });
  const ticket = check.begin();
  const found = await Promise.all(git.map((p) => probeSetup(p.path, false))); // the page's own read: no trust question, no refusal to misread
  check.settle(ticket, found.some(Boolean));
  await gh;
  return found.some(Boolean);
}

type Snapshot = { read: Read; cli: CliStatus | null; home: readonly string[] };
const doneOf = (s: Snapshot) => doneFrom({ ...s.read, cli: caps(s.cli, s.home).every((c) => c.ready) });

/** What the guide can tell is done on this computer (ONB-015), read each time the guide opens and
 *  on Re-check. `refresh` reads it again; so does a change of `again` (VIEW-114: the sidebar entry
 *  bumps it on every Setup Guide close, every added project and window focus past the floor, see
 *  sidebar.ts onReread). `onRead` is called as each read starts, the one made when `on` turns true included
 *  (FIX-4: the sidebar entry stamps its focus floor with it). `settled` is the done set of the last
 *  read that fully answered, null until the first one has: it never shows a half-read state. */
export function useGuideState(on: boolean, again: unknown = null, onRead?: () => void) {
  const [cli, setCli] = useState<CliStatus | null>(null);
  const [home, setHome] = useState<string[]>([]);
  const [read, setRead] = useState<Read>(UNREAD);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [n, setN] = useState(0);
  const check = useRef(latest<boolean>((v) => setRead((r) => ({ ...r, setupScript: v })))).current;
  const told = useRef(onRead);
  told.current = onRead;
  useEffect(() => {
    if (!on) return;
    told.current?.();
    let live = true;
    let acc: Read = UNREAD;
    const c = invoke<CliStatus>("cli_status").then(
      (x) => (live && setCli(x), x),
      () => (live && setCli(null), null),
    );
    const h = invoke<Scan>("skills_scan", { workspace: null, refresh: n > 0 }).then(
      (s) => {
        const names = s.skills.filter((k) => k.source === "home").map((k) => k.name);
        if (live) setHome(names);
        return names;
      },
      () => [] as string[],
    );
    const f = readFacts(check, (x) => ((acc = { ...acc, ...x }), live && setRead((r) => ({ ...r, ...x }))), () => live);
    void Promise.all([c, h, f]).then(([cl, hm, script]) => live && setSnap({ read: { ...acc, setupScript: script }, cli: cl, home: hm }));
    return () => void (live = false);
  }, [on, n, check, again]);
  const list = caps(cli, home);
  const done = doneFrom({ ...read, cli: list.every((c) => c.ready) });
  return { cli, caps: list, done, settled: snap ? doneOf(snap) : null, refresh: () => setN((x) => x + 1) };
}

/** The progress ring: core steps done out of all of them. */
export function Ring({ done, total, size = 40 }: { done: number; total: number; size?: number }) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  return (
    <svg className="guide-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${done} of ${total} done`}>
      <circle cx={size / 2} cy={size / 2} r={r} className="track" />
      <circle cx={size / 2} cy={size / 2} r={r} className="fill" strokeDasharray={c} strokeDashoffset={c * (1 - done / Math.max(1, total))} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}

/** Keeps a dialog's content on screen through its closing fade; opening again during the fade
 *  cancels the teardown. */
function useClosing(open: boolean): boolean {
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) return setShown(true);
    const t = window.setTimeout(() => setShown(false), 160);
    return () => window.clearTimeout(t);
  }, [open]);
  return shown;
}

function SetupGuide({ ask, open, onClose }: { ask: StepId | null; open: boolean; onClose: () => void }) {
  const g = useGuideState(open);
  const { save, settings } = useSettings();
  const [hideFailed, setHideFailed] = useState(false);
  const hidden = checklistHidden(settings);
  const [at, setAt] = useState<StepId>(() => firstOpen(g.done, ask));
  const doneKey = [...g.done].join();
  useEffect(() => {
    if (open) setAt(firstOpen(g.done, ask));
  }, [open, ask]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setAt((a) => moveOn(a, g.done)), [doneKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => guideOpenChanged(composer, open), [open]); // ONB-016: a composer request from before a close and reopen is void (FIX-1: closing does not void it)
  const shown = useClosing(open);
  if (!shown) return null;
  const r = ring(g.done);
  const step = STEPS.find((s) => s.id === at)!;
  const row = (s: (typeof STEPS)[number], n?: number) => (
    <button key={s.id} className={`guide-step${s.id === at ? " on" : ""}${g.done.has(s.id) ? " done" : ""}`} aria-current={s.id === at} onClick={() => setAt(s.id)}>
      <span className="tick">{g.done.has(s.id) ? "✓" : n ?? ""}</span>
      <span className="name">{words(s).name}</span>
      {!s.core && <span className="opt">Optional</span>}
    </button>
  );
  return (
    <div className={`ask-backdrop${open ? "" : " closing"}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="guide" role="dialog" aria-modal="true" tabIndex={-1} aria-label="Getting Started with Kolux" onKeyDown={(e) => (trapTab(e), e.key === "Escape" && onClose())}>
        <aside className="guide-side">
          <header className="guide-head">
            <Ring done={r.done} total={r.total} />
            <div>
              <h2>Getting Started</h2>
              <p>
                {r.done} of {r.total} done
              </p>
            </div>
            <span className="spacer" />
            <button
              className="ib"
              title={hidden ? "The checklist is hidden from the sidebar" : "Remove the checklist from the sidebar"}
              aria-label="Remove the checklist from the sidebar"
              disabled={hidden}
              onClick={() => void save(HIDE_PATCH).then((ok) => setHideFailed(!ok))}
            >
              <EyeOff />
            </button>
          </header>
          {hideFailed && (
            <p className="guide-note warn" role="status">
              The checklist could not be hidden. Try again.
            </p>
          )}
          <p className="guide-group">Setup</p>
          {STEPS.filter((s) => s.group === "setup").map((s) => row(s))}
          <p className="guide-group">Parallel work</p>
          {STEPS.filter((s) => s.group === "parallel").map((s, i) => row(s, i + 1))}
        </aside>
        <section className="guide-panel">
          <header>
            <h3>{words(step).name}</h3>
            <button className="ib" title="Close (Esc)" onClick={onClose} autoFocus>
              <Close />
            </button>
          </header>
          <p>{words(step).about}</p>
          {step.id === "cli" && <CliSetup list={g.caps} onChanged={g.refresh} />}
          {step.id === "multitask" && <MultitaskPanel close={onClose} />}
          {step.id === "notifications" && <NotificationsPanel />}
          {step.id === "agent" && <AgentPanel />}
          {step.id === "integrations" && <IntegrationsPanel onCheck={g.refresh} />}
          {step.id === "automate" && <AutomatePanel onCheck={g.refresh} />}
          {g.done.has(step.id) && <p className="guide-done">Done</p>}
        </section>
      </div>
    </div>
  );
}

function Explore({ onClose }: { onClose: () => void }) {
  const [at, setAt] = useState<At>({ w: 0, s: -1 });
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [setup, setSetup] = useState<Setup>({ taskSource: false, skills: [] });
  const [gh, setGh] = useState<boolean | null>(null);
  const rail = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(dialog, onClose); // 49-ux2: focus on open, Escape from anywhere, focus back on close
  useEffect(() => {
    // Merged, not replaced: a stop visited before the record arrived stays seen (FIX-1).
    invoke<GuideRecord>("guide_get").then((g) => (setSeen((s) => withRecord(s, new Set(), g).seen), setKept((k) => withRecord(new Set(), k, g).kept)), () => {});
    // ONB-023: the setup a stop carries, read when the tour opens.
    // FIX-1: GitHub counts as connected by the Connect integrations rule (sign-in accepted, task search answered),
    // not by a cached sign-in alone; null until the read lands, so the stop says it is checking.
    readSeenCached(invoke).then((x) => (setGh(taskSourceOf(x)), setSetup((s) => ({ ...s, taskSource: taskSourceOf(x) === true }))));
    invoke<Scan>("skills_scan", { workspace: null, refresh: false }).then((r) => setSetup((s) => ({ ...s, skills: r.skills.filter((k) => k.source === "home").map((k) => k.name) })), () => {});
  }, []);
  const stop = stopOf(at);
  useEffect(() => {
    setSeen((s) => new Set(s).add(stop.id));
    markGuide("visited", stop.id).catch(() => {});
  }, [stop.id]);
  // ONB-023: a stop that is complete is kept complete on the profile, whatever detection says later.
  const isDone = (id: string) => stopDone(id, seen, setup, kept);
  const newlyDone = WORKFLOWS.flatMap((w) => [w.id, ...w.stops.map((s) => s.id)]).filter((id) => !kept.has(doneId(id)) && isDone(id));
  const doneKey = newlyDone.join();
  useEffect(() => {
    for (const id of newlyDone) markGuide("tried", doneId(id)).catch(() => {});
    if (newlyDone.length) setKept((k) => new Set([...k, ...newlyDone.map(doneId)]));
  }, [doneKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = forward(at);
  const go = () => (next ? setAt(next) : onClose());
  const wf = WORKFLOWS[at.w];
  return (
    <div className="ask-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        tabIndex={-1}
        className="explore"
        role="dialog"
        aria-modal="true"
        aria-label="Explore Kolux"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            go();
          }
        }}
      >
        <div className="explore-rail" role="tablist" aria-orientation="vertical" ref={rail}>
          <p className="guide-group">A short walk through Kolux, one workflow at a time</p>
          {WORKFLOWS.map((w, i) => (
            <button
              key={w.id}
              role="tab"
              aria-selected={i === at.w}
              tabIndex={i === at.w ? 0 : -1}
              className={`explore-wf${i === at.w ? " on" : ""}`}
              onClick={() => setAt({ w: i, s: -1 })}
              onKeyDown={(e) => {
                const to = railKey(e.key, at.w);
                if (to === null) return;
                e.preventDefault();
                setAt({ w: to, s: -1 });
                (rail.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[to])?.focus();
              }}
            >
              <span className="name">{w.title}</span>
              {workflowDone(w, seen, setup, kept) && <span className="mark ok">Completed</span>}
            </button>
          ))}
        </div>
        <section className="explore-main" role="tabpanel">
          <header>
            <span className="spacer" />
            <button className="ib" title="Close (Esc)" onClick={onClose}>
              <Close />
            </button>
          </header>
          <div className={`explore-pic pic-${wf.id}`} aria-hidden="true">
            <span>{wf.title}</span>
          </div>
          {wf.stops.length > 0 && (
            <div className="explore-stops">
              {wf.stops.map((s, i) => (
                <button key={s.id} className={`chip${at.s === i ? " on" : ""}`} onClick={() => setAt({ w: at.w, s: i })}>
                  {s.title}
                  {s.optional && <span className="opt">Optional</span>}
                  {isDone(s.id) && <span className="mark ok">✓</span>}
                </button>
              ))}
            </div>
          )}
          <h3>{stop.title}</h3>
          <p>{stop.caption}</p>
          <Demo stop={stop.id} />
          <StopSetup stop={stop.id} taskSource={gh} />
          <div className="btn-row">
            <span className="spacer" />
            <span className="hint">
              {submitKeys().map((k, i) => (
                <span key={i}>
                  {i > 0 && "+"}
                  <span className="kbd">{k}</span>
                </span>
              ))}
            </span>
            <button className="btn primary" onClick={go}>
              {next ? "Continue" : "Done"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

/** ONB-029: the palette's key chips, following the user's binding; the default when unassigned. */
function PaletteKeys() {
  const map = useKeymap();
  const parts = paletteKeys(labelOf(map, "worktree.palette"), labelOf(defaultsOnly(map.platform), "worktree.palette"));
  return (
    <>
      {parts.map((p, i) => (
        <span key={i} className="kbd-part">
          {i > 0 && <span className="kbd-plus">+</span>}
          <span className="kbd">{p}</span>
        </span>
      ))}
    </>
  );
}

/** ONB-029: a short demo of typing into the palette that brings up a create-workspace row. It plays
 *  once and stops; with reduced motion it shows the end state and runs no timer. */
function PaletteDemo() {
  const reduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const frames = useRef(demoFrames(reduced)).current;
  const [i, setI] = useState(0);
  useEffect(() => {
    if (i >= frames.length - 1) return;
    const t = window.setTimeout(() => setI(i + 1), i === 0 ? 600 : 110);
    return () => window.clearTimeout(t);
  }, [i, frames.length]);
  const f = frames[i];
  return (
    <div className="onb-demo" aria-hidden>
      <div className="onb-demo-input">
        {f.typed}
        <span className="caret" />
      </div>
      {f.create && <div className="onb-demo-row">Create workspace “{f.typed}”</div>}
    </div>
  );
}

/** ONB-028: the tip's own setup: the same panel as the Setup Guide's CLI step, read fresh when it opens. */
function TipSetup() {
  const c = useCliCaps(true);
  return <CliSetup list={c.caps} onChanged={c.refresh} />;
}

/** ONB-027: at most one tip per launch, once settings, onboarding and the CLI status are known and
 *  no other dialog is open. A tip counts as seen the moment it appears. */
function StartupTip() {
  const [tip, setTip] = useState<TipId | null>(null);
  const [cli, setCli] = useState<CliStatus | null>(null);
  const [setup, setSetup] = useState(false);
  useEffect(() => {
    let live = true;
    let timer = 0;
    Promise.all([
      invoke<unknown>("onboarding_get"),
      invoke<GuideRecord>("guide_get"),
      invoke<CliStatus>("cli_status").catch(() => "error" as const),
      invoke("get_settings"),
    ]).then(([onb, g, c]) => {
      const t = nextTip({ seen: g.tipsSeen, tried: g.tried, cli: c, onboarding: onb !== null, features: g.features });
      if (!t) return;
      const show = () => {
        if (!live) return;
        if (document.querySelector("[role=dialog]")) return void (timer = window.setTimeout(show, 1000));
        markGuide("tipsSeen", t).catch(() => {});
        if (c !== "error") setCli(c);
        setTip(t);
      };
      show();
    }, () => {});
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, []);
  const close = () => (setTip(null), setSetup(false));
  // T-612: Escape closes the tip from wherever the keyboard is (the card never takes it).
  useEffect(() => {
    if (!tip) return;
    return tipEscape(window as unknown as Parameters<typeof tipEscape>[0], () => document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]') !== null, close);
  }, [tip]);
  if (!tip) return null;
  return <TipDocked tip={tip} cli={cli} setup={setup} onSetup={() => setSetup(true)} onClose={close} />;
}

type TipKey = { key: string; isComposing: boolean };

/** T-612 (PLAN.md T-566, Tip part): Escape closes the tip wherever the keyboard is, since the card leaves the keyboard
 *  in the restored pane; a modal dialog's Escape stays its own. Listens in the capture phase so a focused terminal
 *  cannot swallow it first, but never takes the key: the same Escape still closes the palette, Settings or a menu and
 *  still reaches the terminal program (in Claude Code it interrupts the agent). Returns the cleanup. */
export function tipEscape(
  win: { addEventListener(t: "keydown", f: (e: TipKey) => void, capture: boolean): void; removeEventListener(t: "keydown", f: (e: TipKey) => void, capture: boolean): void },
  modalOpen: () => boolean,
  close: () => void,
): () => void {
  const key = (e: TipKey) => {
    if (e.key === "Escape" && !e.isComposing && !modalOpen()) close();
  };
  win.addEventListener("keydown", key, true);
  return () => win.removeEventListener("keydown", key, true);
}

function TipDocked(props: Omit<Parameters<typeof TipView>[0], "dock">) {
  return <TipView {...props} dock={useTipDock()} />;
}

/** Where the tip sits: over the left sidebar column when it is open and at least 240 wide, so a restored
 *  terminal grid stays uncovered; else the bottom right. Always clear of the status bar (ONB-027 timing is unchanged). */
export function tipDock(sidebar: Rect | null, statusTop: number, viewport: { width: number; height: number }): CSSProperties {
  const bottom = Math.max(0, viewport.height - statusTop + 16);
  if (!sidebar || sidebar.width < 240 || sidebar.left + sidebar.width <= 0) return { right: 16, bottom: 40 };
  const width = Math.min(sidebar.width, Math.max(240, Math.min(420, sidebar.width - 16)));
  return { left: sidebar.left + Math.min(8, (sidebar.width - width) / 2), right: "auto", bottom, width };
}

/** The tip's dock style from the live sidebar and status bar; follows window and sidebar resizes. */
function useTipDock(): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ right: 16, bottom: 40 });
  useEffect(() => {
    const aside = document.querySelector('aside.sidebar[aria-label="Sidebar"]');
    const read = () => {
      const sb = aside?.getBoundingClientRect();
      const st = document.querySelector("footer.statusbar")?.getBoundingClientRect();
      const next = tipDock(sb && sb.width > 0 && sb.height > 0 ? { left: sb.left, top: sb.top, width: sb.width, height: sb.height } : null, st && st.height > 0 ? st.top : window.innerHeight - 24, { width: window.innerWidth, height: window.innerHeight });
      setStyle((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
    };
    read();
    window.addEventListener("resize", read);
    const ro = aside && typeof ResizeObserver !== "undefined" ? new ResizeObserver(read) : null;
    if (aside) ro?.observe(aside);
    return () => (window.removeEventListener("resize", read), ro?.disconnect());
  }, []);
  return style;
}

/** The tip's markup, apart from the launch timing above. */
export function TipView({ tip, cli, setup, onSetup, onClose: close, dock = { right: 16, bottom: 40 } }: { tip: TipId; cli: CliStatus | null; setup: boolean; onSetup: () => void; onClose: () => void; dock?: CSSProperties }) {
  return (
    <div className="tip-dock" style={dock} data-docked={dock.left !== undefined ? "" : undefined}>
      <div className="tip-card" role="dialog" aria-modal="false" aria-label="Tip">
        <span className="tip-badge">Tip</span>
        {tip !== "cli" && tip !== "palette" ? (
          <>
            <h3>{MOVED.find((m) => m.id === tip)?.title}</h3>
            <p>{MOVED.find((m) => m.id === tip)?.text}</p>
            <div className="btn-row">
              <span className="spacer" />
              <button className="btn primary" onClick={close}>
                Got it
              </button>
            </div>
          </>
        ) : tip === "cli" ? (
          <>
            <h3>Let your agents drive Kolux</h3>
            <ul>
              <li>Open terminals and type into them from any agent</li>
              <li>Start other agents, hand them work and wait for their results</li>
              <li>Teach every agent Kolux's commands through its skills</li>
            </ul>
            {cli?.installed && !cli.onPath && <p className="tip-warn">Needs attention: the kolux command is installed, but terminals outside Kolux cannot find it.</p>}
            {setup && <TipSetup />}
            <div className="btn-row">
              <button className="btn" onClick={close}>
                {setup ? "Close" : "Not now"}
              </button>
              {!setup && (
                <button className="btn primary" onClick={onSetup}>
                  Install CLI &amp; Skills
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <h3>
              Jump to any workspace with <PaletteKeys />
            </h3>
            <PaletteDemo />
            <p>Type part of a name to switch, or a new name to create a workspace. Change the keys in Settings › Shortcuts.</p>
            <div className="btn-row">
              <span className="spacer" />
              <button className="btn primary" onClick={close}>
                Got it
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** T-608: the one line of consent for a profile that never answered it, outside the first-run wizard. */
export function HooksAskView({
  on,
  onSwitch,
  onDone,
  onLater,
  onOff,
  dock = { right: 16, bottom: 40 },
}: {
  on: boolean;
  onSwitch: (on: boolean) => void;
  onDone: () => void;
  /** 49-ux2: Not now closes the card without answering; it asks again at the next launch. */
  onLater?: () => void;
  /** 49-ux2: Off records "no" and closes the card. */
  onOff?: () => void;
  dock?: CSSProperties;
}) {
  return (
    <div className="tip-dock" style={dock} data-docked={dock.left !== undefined ? "" : undefined}>
      <div className="tip-card" role="dialog" aria-modal="false" aria-label="Agent status hooks">
        <span className="tip-badge">Status</span>
        <label className="onb-ping">
          <input type="checkbox" role="switch" checked={on} onChange={(e) => onSwitch(e.target.checked)} />
          <span>{HOOKS_LINE}</span>
        </label>
        <div className="btn-row">
          <span className="spacer" />
          {onLater && (
            <button className="btn" onClick={onLater}>
              Not now
            </button>
          )}
          {onOff && (
            <button className="btn" onClick={onOff}>
              Turn off
            </button>
          )}
          <button className="btn primary" onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** T-608: shows once no other dialog is open; Done records the switch. Until it is answered it asks again
 *  at the next launch, so nothing is installed for a profile that never saw the line. */
export function HooksAsk({ settings, onDone }: { settings: Record<string, unknown> | null; onDone: () => void }) {
  const [on, setOn] = useState(() => hooksDefault(settings)); // review of PR #16: the saved answer, else on
  const [shown, setShown] = useState(false);
  const dock = useTipDock();
  useEffect(() => {
    let timer = 0;
    const show = () => (document.querySelector("[role=dialog]") ? (timer = window.setTimeout(show, 1000)) : setShown(true));
    show();
    return () => window.clearTimeout(timer);
  }, []);
  if (!shown) return null;
  return (
    <HooksAskView
      on={on}
      onSwitch={setOn}
      dock={dock}
      onDone={() => (void recordHooks(on).catch(() => {}), onDone())}
      onLater={onDone}
      onOff={() => (void recordHooks(false).catch(() => {}), onDone())}
    />
  );
}

/** The window's guides: one mount line in App.tsx. */
export default function Guides() {
  const [guide, setGuide] = useState<{ open: boolean; ask: StepId | null }>({ open: false, ask: null });
  const [explore, setExplore] = useState(false);
  const guideOpen = useRef(false);
  guideOpen.current = guide.open;
  // T-608: "ask" shows the hooks line once; that launch shows no startup tip (one card per launch).
  const [hooksAsk, setHooksAsk] = useState<"wait" | "ask" | "done" | "no">("wait");
  const hooksSettings = useRef<Record<string, unknown> | null>(null);
  useEffect(() => {
    Promise.all([invoke<unknown>("onboarding_get"), invoke<Record<string, unknown>>("get_settings")]).then(
      ([onb, s]) => ((hooksSettings.current = s), setHooksAsk(askHooks(s, onb !== null) ? "ask" : "no")),
      () => setHooksAsk("no"),
    );
  }, []);
  useEffect(() => {
    const g = (e: Event) => setGuide({ open: true, ask: (e as CustomEvent<StepId | null>).detail });
    const x = () => setExplore(true);
    window.addEventListener(OPEN_GUIDE, g);
    window.addEventListener(OPEN_EXPLORE, x);
    const off = closeOnSettings(() =>
      stepAside(
        guideOpen.current,
        () => setExplore(false),
        () => (setGuide((s) => ({ ...s, open: false })), guideClosed()), // the sidebar entry re-reads its steps
      ),
    );
    return () => {
      window.removeEventListener(OPEN_GUIDE, g);
      window.removeEventListener(OPEN_EXPLORE, x);
      off();
    };
  }, []);
  return (
    <>
      <SetupGuide
        open={guide.open}
        ask={guide.ask}
        onClose={() => {
          setGuide((g) => ({ ...g, open: false }));
          guideClosed();
        }}
      />
      {explore && <Explore onClose={() => setExplore(false)} />}
      {hooksAsk === "ask" && <HooksAsk settings={hooksSettings.current} onDone={() => setHooksAsk("done")} />}
      {hooksAsk === "no" && <StartupTip />}
      <Tours />
      <StarPrompt />
    </>
  );
}
