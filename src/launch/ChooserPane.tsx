// A pane where nothing runs yet (SESS-007): it asks what to run. One radio group per seat for the
// AI (installed agents, or a plain terminal) and, for an AI, a second radio group for the model;
// Start stays disabled until every seat has both picks. A count row (SESS-013) grows the seat
// list with empty seats or shrinks it from the bottom. Native radios and a number field carry the
// keyboard and screen-reader behaviour. The close button is absent when this is the grid's only
// pane. A shape row (SESS-012) gives the seats roles, each shown on its seat, and one task box
// holds the task every seat shares, so the whole lineup is in view before Start. Start sits in a
// footer below the scrolling choices, so in a small pane it stays in view after a pick. Saved shapes
// (SESS-020) sit after the built-in ones; each has a menu to rename or delete it, and a delete can
// be undone from the note it leaves. A model with
// effort levels or fast mode shows those options on its seat only (SESS-016); "Use last lineup"
// (SESS-021) appears when this project has one whose agents are still here.
import { useContext, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Close, Dots } from "../chrome/icons";
import { openSettings } from "../settings/pages";
import { launchWarnings, useLaunchUsage } from "../usage/launchWarn";
import VendorMark from "../chrome/VendorMark";
import AgentMark from "../marks/AgentMark";
import { markFor, type AgentInfo } from "./PlusMenu";
import { canLaunch, type AgentPass } from "./agents";
import { seatStart, type SeatDefault } from "./defaultSeat";
import { everySeatStart, folderPlan, oneForAll, pickForAll, pickWords, recountAll, setAll, startSummary, type FolderRow } from "./startForm";
import { canInstall, FEATURED, featuredRows, installNoteOf, installTip, otherRows, pickList, runInstall } from "./agentInstall";
import { useKeymap } from "../keys/KeymapContext";
import { useDialogFocus } from "../chrome/dialogFocus";
import { WindowStore } from "../shell/window/store";
import { gridSheet } from "./emptySlots";
import { allReady, COUNT_PAUSE_MS, countPlan, pauseThen, MAX_SESSIONS, modelsFor, NOT_GIT, pickShape, QUICK_COUNTS, renameShape, restoreTeam, sameForAll, saveShape, seatGap, seatReady, SHAPES, sharedWarning, shownPick, TERMINAL, type Copies, type SavedShape, type Seat, type Shape, choiceOf, lineupAgents, type Lineup, LISTED, setDiscovered, knownModel } from "./seats";
import { singleFolder } from "../projects/singleFolder";

/** SESS-017: a link to the agent's own documentation, when Kolux knows it (agents.rs `install_page`). */
function DocsLink({ agent }: { agent: AgentInfo }) {
  const [error, setError] = useState<string | null>(null);
  if (!agent.docs) return null;
  return (
    <>
      <button className="btn link agent-link" onClick={() => void invoke("open_install_page", { agent: agent.id }).then(() => setError(null), (e) => setError(`Could not open the ${agent.name} page: ${String(e)}`))} aria-label={`${agent.name} docs`} title={`Open ${agent.name}'s own documentation`}>
        Docs
      </button>
      {error && (
        <span className="agent-missing" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

/** Txais 2026-11-08: the window behind a seat's Other button, listing installed agents without a button of their own. */
function OtherAgents({ seat, agents, picked, onPick, onMore, onClose }: { seat: number | null; agents: AgentInfo[]; picked: string | null; onPick: (id: string) => void; onMore: () => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box, onClose); // focus on open, Tab kept inside, Escape from anywhere, focus back on close
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className="other-agents" role="dialog" aria-modal="true" aria-label="Other AI programs">
        <h2>Other AI programs</h2>
        <span className="caption">{seat === null ? "Installed on this computer. Your pick goes to all of them." : `Installed on this computer. Your pick runs in seat ${seat + 1}.`}</span>
        {agents.length === 0 ? (
          <span className="caption">No other AI programs are installed.</span>
        ) : (
          <div className="other-agents-list">
            {agents.map((a) => (
              <button key={a.id} className="btn agent-btn" aria-pressed={picked === a.id} onClick={() => onPick(a.id)}>
                <VendorMark agent={markFor(a.id)} size={12} />
                {a.name}
              </button>
            ))}
          </div>
        )}
        <div className="btn-row">
          <button className="btn link" onClick={onMore}>
            Add more agents
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** Txais 2026-11-08: a button each for Claude Code, Codex, OpenCode and Grok (FEATURED), then Terminal and Other…; the rest sit
 * behind Other. One group serves both the Start form's one row for all (`pick` null while the seats differ) and each seat.
 * Test ids: the caller names the group (`all-agents`, `seat-<n>-agents`) and the buttons are `seat-agent-<id>` in every
 * group. Each id is written out where scripts/smoke-testids.test.mjs can read it; an id built from a prefix would match
 * any id at all in that check. */
function AgentButtons({ rows, pick, label, "data-testid": testid, onChoose, onOther }: { rows: AgentInfo[]; pick: string | null; label: string; "data-testid": string; onChoose: (id: string) => void; onOther: () => void }) {
  const other = pick && pick !== TERMINAL && !FEATURED.includes(pick) ? rows.find((x) => x.id === pick) : undefined;
  return (
    <div className="agent-grid" role="group" data-testid={testid} aria-label={label}>
      {featuredRows(rows).map((a) => (
        <button key={a.id} className="btn agent-btn" data-testid={`seat-agent-${a.id}`} aria-pressed={pick === a.id} title={a.installed ? a.name : `${a.name} is not installed. Pick it to install it.`} onClick={() => onChoose(a.id)}>
          <AgentMark id={a.id} size={28} />
          <span className="agent-btn-name">{a.name}</span>
          {!a.installed && <span className="agent-btn-note">not installed</span>}
        </button>
      ))}
      <button className="btn agent-btn" data-testid="seat-agent-terminal" aria-pressed={pick === TERMINAL} title="A plain terminal, no AI" onClick={() => onChoose(TERMINAL)}>
        <VendorMark agent="shell" size={28} />
        <span className="agent-btn-name">Terminal</span>
      </button>
      {/* job 47: while the search runs there are no rows, so only Terminal is offered */}
      {rows.length > 0 && (
        <button className="btn agent-btn" aria-pressed={!!other} aria-haspopup="dialog" title="Pick any other installed AI program" onClick={onOther}>
          {other ? <AgentMark id={other.id} size={28} /> : <Dots size={28} />}
          <span className="agent-btn-name">{other ? `Other: ${other.name}` : "Other…"}</span>
        </button>
      )}
    </div>
  );
}

/** UX audit F4: what a missing agent with no Install route and no docs page tells the person to do. */
export const selfInstallHint = (a: AgentInfo): string | null => (!a.installed && !canInstall(a) && !a.docs ? `Kolux cannot install ${a.name} for you. Install it yourself, then press Refresh agents.` : null);

/** UX audit F4: Esc inside a text box that holds typing only leaves the box, so a stray Esc does not throw the typing away. */
export const holdsTyping = (el: { tagName?: string; value?: string; type?: string } | null): boolean => {
  const tag = el?.tagName?.toUpperCase();
  return (tag === "TEXTAREA" || (tag === "INPUT" && (el?.type === "text" || el?.type === undefined))) && !!el?.value?.trim();
};

/** SESS-018: what a key does on the New session page: Ctrl+Enter (Cmd+Enter on a Mac) launches a
 * complete lineup and is "blocked" while a seat is unfinished; Escape closes the page. */
export function sheetKey(e: { key: string; ctrlKey: boolean; metaKey: boolean }, seats: Seat[], mac: boolean, busy = false, onForm = false): "launch" | "blocked" | "close" | null {
  if (e.key === "Escape") return busy ? null : "close";
  // Wave 2 item 3: the form takes focus when it opens, so plain Enter there starts the prefilled answer.
  const plain = onForm && !e.ctrlKey && !e.metaKey;
  if (e.key !== "Enter" || !(plain || (mac ? e.metaKey : e.ctrlKey))) return null;
  return allReady(seats) ? "launch" : "blocked";
}

const asked: Record<string, Promise<boolean>> = {};
/** SESS-029: one live model listing per agent per app run; true when it added models. */
function liveModels(id: string): Promise<boolean> {
  asked[id] ??= invoke<{ id: string; label: string }[] | null>("agent_models", { id })
    .then((found) => {
      setDiscovered(id, found);
      return !!found?.length;
    })
    .catch(() => false);
  return asked[id];
}

type Props = {
  /** The session's number, shown in the header. */
  number: number;
  hidden?: boolean;
  focused?: boolean;
  /** The offered agents, installed or not (SESS-017). */
  agents: AgentInfo[];
  /** True until the first detection answers: then nothing is called missing. */
  detecting?: boolean;
  seats: Seat[];
  onSeats: (seats: Seat[]) => void;
  /** SESS-012: the launch shape; a shape pick or a count change sets the shape and the seats together. */
  shape: Shape;
  onLineup: (shape: Shape, seats: Seat[]) => void;
  /** SESS-012: the task every seat shares; blank means none. */
  task: string;
  onTask: (task: string) => void;
  onStart: (seats: Seat[]) => void;
  /** SESS-014: where the AIs work; `inGit` false disables the separate copies. */
  copies: Copies;
  inGit: boolean;
  onCopies: (copies: Copies) => void;
  busy?: boolean;
  /** False when this is the grid's only pane: then there is no close button. */
  closable: boolean;
  onClose: () => void;
  onFocus?: () => void;
  /** SESS-020: the saved shapes, the new list after a save, rename, delete or undo, and a pick. */
  saved: SavedShape[];
  onSaved: (list: SavedShape[]) => void;
  onPickSaved: (shape: SavedShape) => void;
  /** SESS-002: where the agent search stands; Start waits for a pass that succeeded. */
  pass?: AgentPass;
  onRefresh?: () => void;
  /** T-571: the model and effort a newly picked agent starts on (settings defaultModel, defaultEffort). */
  seatDefault?: SeatDefault;
  /** SESS-021: this project's last lineup, when it has one worth offering; applied only on the click. */
  lastLineup?: Lineup | null;
  onUseLineup?: () => void;
  /** T-809: the default agent's id; seat 1 starts on it once detection has answered, when it is installed and the seats are all still blank. */
  defaultAgent?: string;
  /** SESS-018: set on the New look: the chooser is the full-page New session sheet for this project. */
  sheet?: { project: string; path: string } | null;
  /** Start form C: the known project folders (most recent first), the ticked ones, each grid's cells in use, and Add folder. */
  folders?: { rows: FolderRow[]; ticked: string[]; used: Record<string, number>; onTick: (ids: string[]) => void; onAdd: () => void; usual?: string[] } | null;
  /** Start form D: the close button's words when the form was asked at app open ("Keep what was open"). */
  keepLabel?: string;
};

export default function ChooserPane({ number, hidden = false, focused = false, agents, detecting = false, seats, onSeats, shape, onLineup, task, onTask, onStart, copies, inGit, onCopies, busy = false, closable, onClose, onFocus, saved, onSaved, onPickSaved, pass, onRefresh, seatDefault: seatDefault_ = { model: "", effort: "" }, lastLineup, onUseLineup, sheet = null, defaultAgent = "", folders = null, keepLabel = "Cancel" }: Props) {
  const mac = useKeymap().platform === "darwin";
  // SESS-018: a Ctrl+Enter that cannot launch points at the footer's unfinished seat.
  const [nudged, setNudged] = useState(false);
  const gap = seatGap(seats);
  const sessions = seats.length;
  // T-570: one dropdown per seat lists every agent; a missing one can be picked, which shows Install. `fixed` holds agents
  // installed from here until the next detection pass; `shown` is a seat's pick that is not startable yet.
  const [fixed, setFixed] = useState<Record<string, AgentInfo>>({});
  const [shown, setShown] = useState<Record<number, string>>({});
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<Record<string, string>>({});
  const rows = pickList(agents.map((a) => fixed[a.id] ?? a), detecting);
  const none = !detecting && !rows.some((a) => a.installed);
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const noneNote = (
    <span className="caption">
      No AI programs have been found yet. Pick one below to install it, or{" "}
      <button className="btn link" onClick={() => openSettings("accounts")}>
        open Settings
      </button>
      .
    </span>
  );
  // TERM-012: a chooser Kolux focuses takes the keyboard, so typing no longer lands in the last pane.
  const box = useRef<HTMLElement>(null);
  const win = useContext(WindowStore);
  // An install finishes later: what it writes is worked out from the seats as they are then, not as they were at the click.
  const seatsRef = useRef(seats);
  seatsRef.current = seats;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => {
    if (focused && !hidden && !box.current?.contains(document.activeElement)) box.current?.focus();
  }, [focused, hidden]);
  // T-809 (P4a-11): seat 1 starts on the default agent instead of an empty 37-entry list; only while every seat is still blank, once.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || detecting) return;
    seeded.current = true;
    const start = everySeatStart(seatsRef.current, defaultAgent, rows, seatDefault_); // Start form A: every blank seat, not only seat 1
    if (start) onSeats(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detecting]);
  // Job 47: a form opened before the folder list came (the wait at open ran out) ticks the usual folders once it lands.
  const noRows = useRef(folders?.rows.length === 0);
  useEffect(() => {
    if (!folders || !noRows.current || folders.rows.length === 0) return;
    noRows.current = false;
    if (folders.ticked.length === 0 && folders.usual?.length) folders.onTick(folders.usual);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders?.rows.length]);
  // A program with no model list has nothing to pick: its seat uses the program's own default.
  const pickAgent = (i: number, id: string) => {
    setShown(({ [i]: _gone, ...rest }) => rest);
    forget(id);
    // T-571: the default model and effort start the seat (else the agent's saved pick, Row 389); the person can still change both.
    setSeat(i, seatStart(id, seatDefault_));
  };
  // An installed agent (or Terminal) starts the seat; a missing one is shown so its Install button appears.
  const chooseAgent = (i: number, id: string) => {
    const a = rows.find((x) => x.id === id);
    if (id === TERMINAL || a?.installed) return pickAgent(i, id);
    setShown((s) => ({ ...s, [i]: id }));
    setSeat(i, { agent: null, model: null, effort: undefined, fast: undefined });
  };
  // Which seat's Other window is open (Txais 2026-11-08: the four main agents get buttons, the rest sit behind Other).
  const [otherFor, setOtherFor] = useState<number | "all" | null>(null);
  // SESS-029: Grok and Cursor are asked for their models once per app run.
  const [, setLive] = useState(0);
  // Job 22 item 3: when the list lands while this form is open, a model it lacks is dropped in the parent's seats too.
  const seatsNow = useRef({ seats, onSeats });
  seatsNow.current = { seats, onSeats };
  // Job 50 A5: each (AI, model) pair the live list dropped, once, so the form can say why a seat lost its model.
  const [gone, setGone] = useState<{ agent: string; model: string }[]>([]);
  // Job 57 F4: picking an AI is a fresh pick, so its old pairs are forgotten (else the line comes back for a model it never had).
  const forget = (id: string) => setGone((g) => (g.some((x) => x.agent === id) ? g.filter((x) => x.agent !== id) : g));
  useEffect(() => {
    let on = true;
    const recheck = () => {
      const { seats: now, onSeats: put } = seatsNow.current;
      const kept = now.map(knownModel);
      if (!on || !kept.some((s, i) => s !== now[i])) return;
      const lost = now.flatMap((s, i) => (s.agent !== null && s.model !== null && kept[i].model === null ? [{ agent: s.agent, model: s.model }] : []));
      setGone((g) => lost.reduce((acc, p) => (acc.some((x) => x.agent === p.agent && x.model === p.model) ? acc : [...acc, p]), g));
      put(kept);
    };
    for (const a of agents) if (a.installed && LISTED.includes(a.id)) void liveModels(a.id).then((n) => n && (setLive((v) => v + 1), recheck()));
    return () => void (on = false);
  }, [agents]);
  const setSeat = (i: number, patch: Partial<Seat>) => onSeats(seats.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const searched = !pass || canLaunch(pass);
  // Start form C: the launch across the ticked folders, and why Start is off when it is.
  const tickedRows = folders ? folders.rows.filter((f) => folders.ticked.includes(f.id)) : [];
  const plan = folders ? (folders.rows.length === 0 ? { total: 0, problem: "Add a folder first." } : folderPlan(seats.length, tickedRows.map((f) => ({ name: f.name, used: folders.used[f.id] ?? 0 })))) : null;
  const ready = allReady(seats) && !busy && searched && !plan?.problem;
  const anyReady = seats.some(seatReady);
  // SESS-022: a line per provider near its limit, above Start; it never disables Start.
  const warnings = launchWarnings(seats.map((s) => s.agent), useLaunchUsage());
  // Job 50 A5: a dropped model's line stays while a seat of that AI still has no model.
  const goneLines = gone.filter((g) => seats.some((s) => s.agent === g.agent && s.model === null)).map((g) => `${nameOf(g.agent)} no longer offers ${g.model}. Pick another.`);
  const [naming, setNaming] = useState<string | null>(null); // the Save as team name field, open when set
  const [menu, setMenu] = useState<{ i: number; name: string } | null>(null); // a saved shape's rename/delete menu
  const [undo, setUndo] = useState<{ team: SavedShape; index: number } | null>(null); // the team just deleted, and where it sat
  const [bigCount, setBigCount] = useState<number | null>(null); // a typed count above ASK_ABOVE, waiting for a yes
  const countBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (countBox.current && document.activeElement !== countBox.current) countBox.current.value = String(seats.length);
  }, [seats.length]);
  const [problem, setProblem] = useState<string | null>(null);
  const undoTimer = useRef<number | null>(null);
  useEffect(() => () => void (undoTimer.current !== null && window.clearTimeout(undoTimer.current)), []);
  const save = () => {
    const out = saveShape(saved, naming ?? "", seats, copies, task);
    if ("error" in out) return setProblem(out.error);
    setProblem(null);
    setNaming(null);
    onSaved(out.list);
  };
  const rename = () => {
    if (!menu) return;
    if (!menu.name.trim()) return setProblem("A team needs a name. Type one, or press Cancel.");
    setProblem(null);
    onSaved(renameShape(saved, menu.i, menu.name));
    setMenu(null);
  };
  const remove = (i: number) => {
    setMenu(null);
    setUndo({ team: saved[i], index: i });
    onSaved(saved.filter((_, j) => j !== i));
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), 8000);
  };
  // The free field applies on Enter or blur, not per keystroke: typing "15" must not pass
  // through a one-seat moment that drops the picks of seats 2 and up.
  const recount = (n: number) => {
    setBigCount(null);
    const next = recountAll(shape, seats, n);
    onLineup(next.shape, next.seats);
  };
  const applyCount = (e: { currentTarget: HTMLInputElement }) => {
    typing.cancel();
    const n = e.currentTarget.valueAsNumber;
    if (Number.isFinite(n) && n >= 1 && n !== seats.length) {
      // UX audit F7: a big number is asked about first, and nothing goes past MAX_SESSIONS.
      const plan = countPlan(n, seats.length);
      if (plan.ask) setBigCount(plan.n);
      else recount(plan.n);
      // the number asked about stays in the box while the question is open; Keep puts the count back
      e.currentTarget.value = String(plan.n);
    } else e.currentTarget.value = String(seats.length);
  };
  // Typing applies once it pauses (COUNT_PAUSE_MS), so "15" never passes through a one-seat moment and the user does
  // not have to leave the box to see it take effect.
  const typing = useRef(pauseThen(COUNT_PAUSE_MS)).current;
  useEffect(() => () => typing.cancel(), []);
  const onSheetKey = (e: KeyboardEvent) => {
    if (!sheet || e.defaultPrevented) return;
    const what = sheetKey(e, seats, mac, busy, e.target === box.current);
    if (busy && e.key === "Escape") e.preventDefault(); // Starting: the launch is under way and cannot be called off
    if (what === "close") {
      // Escape inside an open name field closes that field first (its own handler).
      if ((e.target as HTMLElement).closest?.(".count-row input")) return;
      e.preventDefault();
      // A box that holds typing is left first; a second Esc closes the page.
      if (holdsTyping(e.target as HTMLInputElement)) return void box.current?.focus();
      onClose();
    } else if (what === "launch" && ready) {
      e.preventDefault();
      onStart(seats);
    } else if (what === "blocked" || what === "launch") {
      e.preventDefault();
      setNudged(true);
    }
  };
  // SESS-017: the Install route, notes and docs for a picked agent, on a seat or on the one row (seat 0 then stands for all).
  const installBits = (pick: string | null, i: number) => {
    const a = rows.find((x) => x.id === pick);
    if (!a) return null;
    return (
      <>
        {canInstall(a) && (
        <button
          className="btn"
          disabled={installing !== null}
          title={installTip(a)}
          onClick={() => {
            setInstalling(a.id);
            setInstallError(({ [a.id]: _gone, ...rest }) => rest);
            void runInstall(a).then((r) => {
              setInstalling(null);
              if ("error" in r) return setInstallError((x) => ({ ...x, [a.id]: r.error }));
              setFixed((x) => ({ ...x, [a.id]: r.agent }));
              // Every empty seat that was showing this same missing agent takes it too.
              const now = seatsRef.current;
              const same = new Set(now.flatMap((_, j) => (j === i || shownPick(now, shownRef.current, j) === a.id ? [j] : [])));
              setShown((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !same.has(Number(k)))));
              onSeats(now.map((s, j) => (same.has(j) && (j === i || s.agent === null) ? { ...s, ...seatStart(a.id, seatDefault_) } : s)));
              onRefresh?.();
            });
          }}
        >
          {installing === a.id ? "Installing…" : "Install"}
        </button>
        )}
        {installNoteOf(a) && <span className="caption" data-install-note>{installNoteOf(a)}</span>}
        {selfInstallHint(a) && <span className="caption">{selfInstallHint(a)}</span>}
        {installError[a.id] && (
          <span className="agent-missing" role="alert">
            {installError[a.id]}
          </span>
        )}
        <DocsLink agent={a} />
      </>
    );
  };
  // Start form A: the one row's pick for every seat; a missing agent is shown on every seat so Install appears once.
  const one = oneForAll(seats);
  const oneShown = one === "mixed" ? null : (one.agent ?? shown[0] ?? null);
  const oneMissing = oneShown !== null && oneShown !== TERMINAL && !rows.find((a) => a.id === oneShown)?.installed ? oneShown : null;
  const chooseAll = (id: string) => {
    const a = rows.find((x) => x.id === id);
    if (id === TERMINAL || a?.installed) {
      setShown({});
      forget(id);
      return onSeats(pickForAll(seats, id, seatDefault_));
    }
    setShown(Object.fromEntries(seats.map((_, k) => [k, id])));
    onSeats(setAll(seats, { agent: null, model: null }));
  };
  const [eachOpen, setEachOpen] = useState(false);
  const launchKeys = [mac ? "Cmd" : "Ctrl", "Enter"];
  // T-745: with several choosers in the grid, only one shows the sheet; this one is an empty slot until clicked.
  // Mousedown moves the sheet here and removes the button under the pointer, so preventDefault stops the browser
  // from then focusing that removed button and blurring the sheet; the button's onClick serves the keyboard.
  const sheetHere = !sheet && win ? gridSheet(win) : null;
  if (sheetHere !== null && sheetHere !== number)
    return (
      <section className="pane chooser" data-testid="chooser-pane" hidden={hidden} aria-label={`Session ${number} chooser`} onMouseDown={(e) => (e.preventDefault(), onFocus?.())} style={{ alignItems: "center", justifyContent: "center" }}>
        {closable && (
          <button className="ib" style={{ position: "absolute", top: 6, right: 6 }} onMouseDown={(e) => e.stopPropagation()} onClick={onClose} disabled={busy} aria-label={`Close session ${number}`}>
            <Close size={12} />
          </button>
        )}
        <button className="btn" onClick={onFocus} aria-label={`Choose what to run in session ${number}`}>
          Choose what to run here
        </button>
      </section>
    );
  return (
    <section ref={box} tabIndex={-1} data-testid="chooser-pane" className={`pane chooser${sheet ? " sheet" : ""}${focused ? " focused" : ""}`} hidden={hidden} aria-label={sheet ? "Start" : `Session ${number} chooser`} onMouseDown={onFocus} onKeyDown={onSheetKey}>
      {sheet ? (
        <header className="sheet-head">
          <div className="sheet-title">
            <h2>Start</h2>
            <span className="sheet-project">{sheet.project}</span>
            <span className="sheet-path" title={sheet.path}>
              {sheet.path}
            </span>
          </div>
          <button className="ib" onClick={onClose} disabled={busy} title={busy ? "Starting: this page closes by itself" : "Close (Esc)"} aria-label="Close the Start form">
            <Close size={12} />
          </button>
        </header>
      ) : (
      <header className="pane-head">
        <span className="title">Session {number}</span>
        <span className="word">Choose what to run</span>
        <span className="right">
          {closable && (
            <button className="ib" onClick={onClose} disabled={busy} title={busy ? "Starting: this chooser is replaced by the sessions" : "Close this chooser"}>
              <Close size={12} />
            </button>
          )}
        </span>
      </header>
      )}
      <div className="chooser-body">
        {pass?.error ? (
          <p className="caption warn" role="alert">
            Kolux could not look for agents ({pass.error}). Nothing can start until a search succeeds.
          </p>
        ) : pass && !pass.done ? (
          <p className="caption">Looking for agents…</p>
        ) : null}
        {folders && (
          <div className="count-row" role="group" aria-label="Folders">
            <span className="label">Folders</span>
            {folders.rows.length === 0 && <span className="caption">Add a folder first.</span>}
            {folders.rows.map((f) => (
              <label key={f.id} className="choice" title={f.path}>
                <input type="checkbox" checked={folders.ticked.includes(f.id)} onChange={(e) => folders.onTick(e.currentTarget.checked ? [...folders.ticked, f.id] : folders.ticked.filter((id) => id !== f.id))} />
                {f.name}
              </label>
            ))}
            <button className="btn" onClick={folders.onAdd} title="Add a project folder Kolux can open">
              Add folder
            </button>
          </div>
        )}
        <div className="count-row" role="group" aria-label="How many sessions">
          <span className="label">How many</span>
          {QUICK_COUNTS.map((n) => (
            <button key={n} className="btn" aria-pressed={seats.length === n} onClick={() => recount(n)}>
              {n}
            </button>
          ))}
          <input
            ref={countBox}
            className="count-field"
            type="number"
            min={1}
            max={MAX_SESSIONS}
            aria-label="Any number of sessions"
            defaultValue={seats.length}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={applyCount}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyCount(e);
            }}
            onChange={(e) => {
              // The spinner and arrow keys step the value: that is a whole number, apply at once.
              if (!(e.nativeEvent as InputEvent).inputType) applyCount(e);
              else {
                const box = e.currentTarget;
                typing.later(() => applyCount({ currentTarget: box }));
              }
            }}
          />
          {folders && <span className="caption">in each folder</span>}
        </div>
        {bigCount !== null && (
          <div className="note warn" role="alert">
            {`${bigCount} sessions is a lot: ${copies === "separate" ? "with own folders each AI seat makes a folder of its own" : "every seat works in the same folder"}. `}
            <button className="btn" onClick={() => recount(bigCount)}>
              {`Use ${bigCount}`}
            </button>{" "}
            <button
              className="btn"
              onClick={() => {
                setBigCount(null);
                if (countBox.current) countBox.current.value = String(seats.length);
              }}
            >
              {`Keep ${seats.length}`}
            </button>
          </div>
        )}
        <div className="count-row" role="group" aria-label="Which AI">
          <span className="label">Which AI</span>
          {one === "mixed" && <span className="caption">Mixed</span>}
          {detecting && !pass && <span className="caption">Looking for AI programs…</span>}
          {none && noneNote}
          {<AgentButtons rows={rows} pick={one === "mixed" ? null : oneShown} label="Which AI for all of them" data-testid="all-agents" onChoose={chooseAll} onOther={() => setOtherFor("all")} />}
          {one !== "mixed" && one.agent !== null && one.agent !== TERMINAL && modelsFor(one.agent).length > 0 && (
            <div className="choices" role="radiogroup" aria-label="Which model for all of them">
              <span className="label">{one.model === null ? "Pick a model" : "Model"}</span>
              {modelsFor(one.agent).map((m) => (
                <label key={m.id} className="choice">
                  <input type="radio" name={`all-${number}-model`} checked={one.model === m.id} onChange={() => onSeats(setAll(seats, { agent: one.agent, model: m.id, effort: undefined, fast: undefined }))} />
                  {m.label}
                </label>
              ))}
            </div>
          )}
          {one !== "mixed" && choiceOf(seats[0])?.efforts && (
            <label className="choice">
              Effort
              <select aria-label="Effort for all" value={one.effort ?? ""} onChange={(e) => onSeats(setAll(seats, { ...one, effort: e.currentTarget.value || undefined }))}>
                <option value="">{choiceOf(seats[0])?.defaultEffort ? `Model default (${choiceOf(seats[0])?.defaultEffort})` : "Model default"}</option>
                {choiceOf(seats[0])?.efforts?.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          )}
          {one !== "mixed" && choiceOf(seats[0])?.fast && (
            <label className="choice" title="Faster answers at a higher price per token">
              <input type="checkbox" aria-label="Fast mode for all" checked={one.fast === true} onChange={(e) => onSeats(setAll(seats, { ...one, fast: e.currentTarget.checked || undefined }))} />
              Fast mode
            </label>
          )}
          {one !== "mixed" && one.agent !== null && one.agent !== TERMINAL && modelsFor(one.agent).length === 0 && <span className="caption">Uses the program's default model</span>}
          {oneMissing && installBits(oneMissing, 0)}
        </div>
        <details className="chooser-each" open={eachOpen} onToggle={(e) => setEachOpen(e.currentTarget.open)}>
          <summary className="btn link">Make each one different</summary>
        {lastLineup && onUseLineup && (
          <div className="count-row">
            <button className="btn" onClick={onUseLineup} title="Put back this project's last shape, folders choice and each seat's AI and model">
              {`Use last lineup: ${lineupAgents(lastLineup).map(nameOf).join(", ")}`}
            </button>
          </div>
        )}
        <div className="count-row" role="group" aria-label="Launch shape">
          <span className="label">Shape</span>
          {SHAPES.map((s) => (
            <button key={s.id} className="btn" aria-pressed={shape === s.id} title={s.roles.length ? s.roles.join(", ") : "No roles"} onClick={() => onLineup(s.id, pickShape(s.id, seats))}>
              {s.label}
            </button>
          ))}
          {saved.map((t, i) => (
            <span key={i} className="saved-shape" data-saved-shape={t.name}>
              <button className="btn" title={`${t.seats.length} seat${t.seats.length === 1 ? "" : "s"}: ${t.seats.map((x) => x.role ?? x.agent).join(", ")}`} onClick={() => onPickSaved(t)}>
                {t.name}
              </button>
              <button className="ib" title={`Rename or delete ${t.name}`} aria-expanded={menu?.i === i} onClick={() => setMenu(menu?.i === i ? null : { i, name: t.name })}>
                <Dots size={11} />
              </button>
            </span>
          ))}
          <button className="btn" disabled={!ready} title={ready ? "Save this lineup to pick again later" : "Pick an AI and a model (or Terminal) for every seat first"} onClick={() => setNaming(naming === null ? "" : null)}>
            Save as team
          </button>
        </div>
        {naming !== null && (
          <div className="count-row" role="group" aria-label="Save as team">
            <input className="seat-job" autoFocus type="text" maxLength={60} placeholder="Team name" aria-label="Team name" value={naming} onChange={(e) => setNaming(e.currentTarget.value)} onKeyDown={(e) => (e.key === "Enter" ? save() : e.key === "Escape" && setNaming(null))} />
            <button className="btn" disabled={!naming.trim()} onClick={save}>
              Save
            </button>
            <button className="btn" onClick={() => setNaming(null)}>
              Cancel
            </button>
          </div>
        )}
        {menu && saved[menu.i] && (
          <div className="count-row" role="group" aria-label={`Saved shape ${saved[menu.i].name}`}>
            <input className="seat-job" autoFocus type="text" maxLength={60} aria-label="New name" value={menu.name} onChange={(e) => setMenu({ ...menu, name: e.currentTarget.value })} onKeyDown={(e) => (e.key === "Enter" ? rename() : e.key === "Escape" && setMenu(null))} />
            <button className="btn" onClick={rename}>
              Rename
            </button>
            <button className="btn" onClick={() => setMenu(null)}>
              Cancel
            </button>
            <button className="btn danger" onClick={() => remove(menu.i)}>
              Delete
            </button>
          </div>
        )}
        {problem && (
          <div className="note warn" role="alert">
            {problem}
          </div>
        )}
        {undo && (
          <div className="note" role="status">
            Deleted {undo.team.name}.{" "}
            <button className="btn" onClick={() => (onSaved(restoreTeam(saved, undo.team, undo.index)), setUndo(null))}>
              Undo
            </button>
          </div>
        )}
          <div className="count-row">
          <button className="btn" disabled={!anyReady || seats.length < 2} onClick={() => onSeats(sameForAll(seats))} title="Copy the first finished seat's AI and model into every seat">
            Same for all
          </button>
          </div>
        {singleFolder() ? (
          <div className="count-row" role="group" aria-label="Where the AIs work">
            <span className="label">Folder</span>
            <span className="caption">Every seat works in this project folder. Kolux does not make extra copies.</span>
          </div>
        ) : (
          // DT-C250: with "Own folder for each agent" on, the choice the chooser had before 2026-11-05 is back.
          <div className="count-row" role="radiogroup" aria-label="Where the AIs work">
            <span className="label">Folders</span>
            <label className="choice" title={inGit ? "Each AI seat gets a fresh folder of its own, on its own branch" : NOT_GIT}>
              <input type="radio" name={`copies-${number}`} checked={copies === "separate"} disabled={!inGit} onChange={() => onCopies("separate")} />
              Own folder for each AI
            </label>
            <label className="choice" title="Every seat opens in this folder">
              <input type="radio" name={`copies-${number}`} checked={copies === "shared"} onChange={() => onCopies("shared")} />
              Same folder for all
            </label>
            {!inGit && <span className="caption">{NOT_GIT}</span>}
          </div>
        )}
        {sharedWarning(copies, seats.length, inGit) && (
          <div className="note warn" role="status">
            Several AIs will edit the same files. Give each a separate task, or launch them one at a time.
            {!singleFolder() && (
              <>
                {" "}
                <button className="btn" onClick={() => onCopies("separate")}>
                  Give each its own folder
                </button>
              </>
            )}
          </div>
        )}
        <div className="seats">
          {seats.map((seat, i) => (
            <div key={i} className="seat">
              <div className="seat-head">
                <span className="seat-title">Seat {i + 1}</span>
                {seat.role && (
                  <span className="chip seat-role" title="This seat's role">
                    {seat.role}
                  </span>
                )}
                <input
                  className="seat-job"
                  type="text"
                  placeholder="Job title (optional)"
                  aria-label={`Seat ${i + 1}: job title`}
                  value={seat.title ?? ""}
                  onChange={(e) => setSeat(i, { title: e.currentTarget.value })}
                />
              </div>
              <div className="choices agent-pick">
                {detecting && !pass && <span className="caption">Looking for AI programs…</span>}
                {none && noneNote}
                {<AgentButtons rows={rows} pick={shownPick(seats, shown, i)} label={`Seat ${i + 1}: which AI`} data-testid={`seat-${i + 1}-agents`} onChoose={(id) => chooseAgent(i, id)} onOther={() => setOtherFor(i)} />}
                {installBits(shownPick(seats, shown, i), i)}
              </div>
              {seat.agent !== null && seat.agent !== TERMINAL && modelsFor(seat.agent).length === 0 && <span className="caption">Uses the program's default model</span>}
              {seat.agent !== null && modelsFor(seat.agent).length > 0 && (
                <div className="choices" role="radiogroup" aria-label={`Seat ${i + 1}: which model`}>
                  <span className="label">{seat.model === null ? "Pick a model" : "Model"}</span>
                  {modelsFor(seat.agent).map((m) => (
                    <label key={m.id} className="choice">
                      <input type="radio" name={`seat-${number}-${i}-model`} checked={seat.model === m.id} onChange={() => setSeat(i, { model: m.id, effort: undefined, fast: undefined })} />
                      {m.label}
                    </label>
                  ))}
                </div>
              )}
              {(choiceOf(seat)?.efforts || choiceOf(seat)?.fast) && (
                <div className="choices">
                  {choiceOf(seat)?.efforts && (
                    <label className="choice">
                      Effort
                      <select aria-label={`Seat ${i + 1}: effort`} value={seat.effort ?? ""} onChange={(e) => setSeat(i, { effort: e.currentTarget.value || undefined })}>
                        <option value="">{choiceOf(seat)?.defaultEffort ? `Model default (${choiceOf(seat)?.defaultEffort})` : "Model default"}</option>
                        {choiceOf(seat)?.efforts?.map((l) => (
                          <option key={l} value={l}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {choiceOf(seat)?.fast && (
                    <label className="choice" title="Faster answers at a higher price per token">
                      <input type="checkbox" aria-label={`Seat ${i + 1}: fast mode`} checked={seat.fast === true} onChange={(e) => setSeat(i, { fast: e.currentTarget.checked || undefined })} />
                      Fast mode
                    </label>
                  )}
                </div>
              )}
              {seat.agent !== null && seat.agent !== TERMINAL && (
                <textarea
                  className="seat-prompt"
                  rows={2}
                  placeholder="Opening prompt (optional)"
                  aria-label={`Seat ${i + 1}: opening prompt`}
                  value={seat.prompt ?? ""}
                  onChange={(e) => setSeat(i, { prompt: e.currentTarget.value })}
                />
              )}
            </div>
          ))}
        </div>
        </details>
        <textarea
          className="seat-prompt"
          rows={2}
          placeholder="Task for all of them (optional)"
          aria-label="Task for all of them"
          value={task}
          onChange={(e) => onTask(e.currentTarget.value)}
        />
        {sheet && (
          <button className="btn link chooser-advanced" onClick={() => openSettings("accounts")} title="Connect or install another AI in Settings">
            Add more agents
          </button>
        )}
      </div>
      <footer className="chooser-foot">
        <div className={`caption chooser-count${nudged && gap ? " warn" : ""}`} role={nudged && gap ? "alert" : "status"}>
          {`${folders ? startSummary(sessions, tickedRows.map((f) => f.name), pickWords(oneForAll(seats), nameOf, (agent, model) => modelsFor(agent).find((m) => m.id === model)?.label ?? model)) : `${sessions} ${sessions === 1 ? "session" : "sessions"}`}${gap ? ` · ${gap}` : ""}`}
        </div>
        {plan?.problem && (
          <div className="note warn" role="status">
            {plan.problem}
          </div>
        )}
        {[...goneLines, ...warnings].map((w) => (
          <div key={w} className="note warn" role="status">
            {w}
          </div>
        ))}
        <div className="btn-row">
          {sheet && (
            <button className="btn" onClick={onClose} disabled={busy}>
              {keepLabel}
            </button>
          )}
          {onRefresh && (
            <button className="btn" disabled={pass?.looking} onClick={onRefresh} title="Look for installed agent CLIs again, for one you just installed">
              {pass?.looking ? "Looking…" : "Refresh agents"}
            </button>
          )}
          <button className="btn primary" data-testid="chooser-start" disabled={!ready} onClick={() => onStart(seats)} title={ready ? "Start every seat" : !searched ? "Waiting for a search for agents that succeeds" : "Pick an AI and a model (or Terminal) for every seat first"}>
            {busy ? "Starting…" : `Start${seats.length > 1 ? ` ${seats.length}` : ""}`}
            {sheet && !busy && (
              <span className="kbd-part sheet-keys" aria-label={launchKeys.join("+")}>
                {launchKeys.map((k, i) => (
                  <span key={k} className="kbd-part">
                    {i > 0 && <span className="kbd-plus">+</span>}
                    <span className="kbd">{k}</span>
                  </span>
                ))}
              </span>
            )}
          </button>
        </div>
      </footer>
      {otherFor !== null && (
        <OtherAgents
          seat={otherFor === "all" ? null : otherFor}
          agents={otherRows(rows)}
          picked={otherFor === "all" ? (one === "mixed" ? null : one.agent) : (seats[otherFor]?.agent ?? null)}
          onPick={(id) => (otherFor === "all" ? chooseAll(id) : pickAgent(otherFor, id), setOtherFor(null))}
          onMore={() => (setOtherFor(null), openSettings("accounts"))}
          onClose={() => setOtherFor(null)}
        />
      )}
    </section>
  );
}
