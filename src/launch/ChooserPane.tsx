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
import { markFor, type AgentInfo } from "./PlusMenu";
import { canLaunch, type AgentPass } from "./agents";
import { seatStart, type SeatDefault } from "./defaultSeat";
import { canInstall, installTip, optionLabel, pickList, runInstall } from "./agentInstall";
import { useKeymap } from "../keys/KeymapContext";
import { WindowStore } from "../shell/window/store";
import { gridSheet } from "./emptySlots";
import { allReady, countPlan, MAX_SESSIONS, modelsFor, NOT_GIT, pickShape, QUICK_COUNTS, renameShape, resizeLineup, restoreTeam, sameForAll, saveShape, seatGap, seatReady, SHAPES, sharedWarning, shownPick, TERMINAL, type Copies, type SavedShape, type Seat, type Shape, choiceOf, lineupAgents, type Lineup, LISTED, setDiscovered } from "./seats";

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

/** UX audit F4: what a missing agent with no Install route and no docs page tells the person to do. */
export const selfInstallHint = (a: AgentInfo): string | null => (!a.installed && !canInstall(a) && !a.docs ? `Kolux cannot install ${a.name} for you. Install it yourself, then press Refresh agents.` : null);

/** UX audit F4: Esc inside a text box that holds typing only leaves the box, so a stray Esc does not throw the typing away. */
export const holdsTyping = (el: { tagName?: string; value?: string; type?: string } | null): boolean => {
  const tag = el?.tagName?.toUpperCase();
  return (tag === "TEXTAREA" || (tag === "INPUT" && (el?.type === "text" || el?.type === undefined))) && !!el?.value?.trim();
};

/** SESS-018: what a key does on the New session page: Ctrl+Enter (Cmd+Enter on a Mac) launches a
 * complete lineup and is "blocked" while a seat is unfinished; Escape closes the page. */
export function sheetKey(e: { key: string; ctrlKey: boolean; metaKey: boolean }, seats: Seat[], mac: boolean, busy = false): "launch" | "blocked" | "close" | null {
  if (e.key === "Escape") return busy ? null : "close";
  if (e.key !== "Enter" || !(mac ? e.metaKey : e.ctrlKey)) return null;
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
  /** SESS-018: set on the New look: the chooser is the full-page New session sheet for this project. */
  sheet?: { project: string; path: string } | null;
};

export default function ChooserPane({ number, hidden = false, focused = false, agents, detecting = false, seats, onSeats, shape, onLineup, task, onTask, onStart, copies, inGit, onCopies, busy = false, closable, onClose, onFocus, saved, onSaved, onPickSaved, pass, onRefresh, seatDefault: seatDefault_ = { model: "", effort: "" }, lastLineup, onUseLineup, sheet = null }: Props) {
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
  // A program with no model list has nothing to pick: its seat uses the program's own default.
  const pickAgent = (i: number, id: string) => {
    setShown(({ [i]: _gone, ...rest }) => rest);
    // T-571: the default model and effort start the seat (else the agent's saved pick, Row 389); the person can still change both.
    setSeat(i, seatStart(id, seatDefault_));
  };
  // SESS-029: Grok and Cursor are asked for their models once per app run.
  const [, setLive] = useState(0);
  useEffect(() => {
    for (const a of agents) if (a.installed && LISTED.includes(a.id)) void liveModels(a.id).then((n) => n && setLive((v) => v + 1));
  }, [agents]);
  const setSeat = (i: number, patch: Partial<Seat>) => onSeats(seats.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const searched = !pass || canLaunch(pass);
  const ready = allReady(seats) && !busy && searched;
  const anyReady = seats.some(seatReady);
  // SESS-022: a line per provider near its limit, above Start; it never disables Start.
  const warnings = launchWarnings(seats.map((s) => s.agent), useLaunchUsage());
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
    const next = resizeLineup(shape, seats, n);
    onLineup(next.shape, next.seats);
  };
  const applyCount = (e: { currentTarget: HTMLInputElement }) => {
    const n = e.currentTarget.valueAsNumber;
    if (Number.isFinite(n) && n >= 1 && n !== seats.length) {
      // UX audit F7: a big number is asked about first, and nothing goes past MAX_SESSIONS.
      const plan = countPlan(n, seats.length);
      if (plan.ask) setBigCount(plan.n);
      else recount(plan.n);
      e.currentTarget.value = String(plan.ask ? seats.length : plan.n);
    } else e.currentTarget.value = String(seats.length);
  };
  const onSheetKey = (e: KeyboardEvent) => {
    if (!sheet || e.defaultPrevented) return;
    const what = sheetKey(e, seats, mac, busy);
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
  const launchKeys = [mac ? "Cmd" : "Ctrl", "Enter"];
  // T-745: with several choosers in the grid, only one shows the sheet; this one is an empty slot until clicked.
  // Mousedown moves the sheet here and removes the button under the pointer, so preventDefault stops the browser
  // from then focusing that removed button and blurring the sheet; the button's onClick serves the keyboard.
  const sheetHere = !sheet && win ? gridSheet(win) : null;
  if (sheetHere !== null && sheetHere !== number)
    return (
      <section className="pane chooser" hidden={hidden} aria-label={`Session ${number} chooser`} onMouseDown={(e) => (e.preventDefault(), onFocus?.())} style={{ alignItems: "center", justifyContent: "center" }}>
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
    <section ref={box} tabIndex={-1} className={`pane chooser${sheet ? " sheet" : ""}${focused ? " focused" : ""}`} hidden={hidden} aria-label={sheet ? "New session" : `Session ${number} chooser`} onMouseDown={onFocus} onKeyDown={onSheetKey}>
      {sheet ? (
        <header className="sheet-head">
          <div className="sheet-title">
            <h2>New session</h2>
            <span className="sheet-project">{sheet.project}</span>
            <span className="sheet-path" title={sheet.path}>
              {sheet.path}
            </span>
          </div>
          <button className="ib" onClick={onClose} disabled={busy} title={busy ? "Starting: this page closes by itself" : "Close (Esc)"} aria-label="Close New session">
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
            <button className="btn primary" disabled={!naming.trim()} onClick={save}>
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
        <div className="count-row" role="group" aria-label="How many sessions">
          <span className="label">Sessions</span>
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
            }}
          />
          <button className="btn" disabled={!anyReady || seats.length < 2} onClick={() => onSeats(sameForAll(seats))} title="Copy the first finished seat's AI and model into every seat">
            Same for all
          </button>
        </div>
        {bigCount !== null && (
          <div className="note warn" role="alert">
            {`${bigCount} sessions is a lot: with separate copies each AI seat makes its own folder. `}
            <button className="btn" onClick={() => recount(bigCount)}>
              {`Use ${bigCount}`}
            </button>{" "}
            <button className="btn" onClick={() => setBigCount(null)}>
              {`Keep ${seats.length}`}
            </button>
          </div>
        )}
        <div className="count-row" role="radiogroup" aria-label="Where the AIs work">
          <span className="label">Folders</span>
          <label className="choice" title={inGit ? "Each AI seat gets a fresh worktree of its own" : NOT_GIT}>
            <input type="radio" name={`copies-${number}`} checked={copies === "separate"} disabled={!inGit} onChange={() => onCopies("separate")} />
            Separate copy for each AI
          </label>
          <label className="choice" title="Every seat opens in this folder">
            <input type="radio" name={`copies-${number}`} checked={copies === "shared"} onChange={() => onCopies("shared")} />
            Same folder for all
          </label>
          {!inGit && <span className="caption">{NOT_GIT}</span>}
        </div>
        {sharedWarning(copies, seats.length, inGit) && (
          <div className="note warn" role="status">
            Several AIs would be editing the same files at once.{" "}
            <button className="btn" onClick={() => onCopies("separate")}>
              Give each its own copy
            </button>
          </div>
        )}
        <textarea
          className="seat-prompt"
          rows={2}
          placeholder="Task for every seat (optional)"
          aria-label="Task for every seat"
          value={task}
          onChange={(e) => onTask(e.currentTarget.value)}
        />
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
                {none && (
                  <span className="caption">
                    No AI programs have been found yet. Pick one below to install it, or{" "}
                    <button className="btn link" onClick={() => openSettings("accounts")}>
                      open Settings
                    </button>
                    .
                  </span>
                )}
                {shownPick(seats, shown, i) && <VendorMark agent={shownPick(seats, shown, i) === TERMINAL ? "shell" : markFor(shownPick(seats, shown, i) ?? "")} size={12} />}
                <select
                  aria-label={`Seat ${i + 1}: which AI`}
                  value={shownPick(seats, shown, i) ?? ""}
                  onChange={(e) => {
                    const id = e.currentTarget.value;
                    const a = rows.find((x) => x.id === id);
                    if (id === TERMINAL || a?.installed) return pickAgent(i, id);
                    setShown((s) => ({ ...s, [i]: id }));
                    setSeat(i, { agent: null, model: null, effort: undefined, fast: undefined });
                  }}
                >
                  <option value="" disabled>
                    Choose an AI…
                  </option>
                  {rows.map((a) => (
                    <option key={a.id} value={a.id}>
                      {optionLabel(a)}
                    </option>
                  ))}
                  <option value={TERMINAL}>Terminal</option>
                </select>
                {(() => {
                  const a = rows.find((x) => x.id === shownPick(seats, shown, i));
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
                      {selfInstallHint(a) && <span className="caption">{selfInstallHint(a)}</span>}
                      {installError[a.id] && (
                        <span className="agent-missing" role="alert">
                          {installError[a.id]}
                        </span>
                      )}
                      <DocsLink agent={a} />
                    </>
                  );
                })()}
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
        {sheet && (
          <button className="btn link chooser-advanced" onClick={() => openSettings("accounts")} title="Connect or install another AI in Settings">
            Add more agents
          </button>
        )}
      </div>
      <footer className="chooser-foot">
        <div className={`caption chooser-count${nudged && gap ? " warn" : ""}`} role={nudged && gap ? "alert" : "status"}>
          {`${sessions} ${sessions === 1 ? "session" : "sessions"}${gap ? ` · ${gap}` : ""}`}
        </div>
        {warnings.map((w) => (
          <div key={w} className="note warn" role="status">
            {w}
          </div>
        ))}
        <div className="btn-row">
          {sheet && (
            <button className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          )}
          {onRefresh && (
            <button className="btn" disabled={pass?.looking} onClick={onRefresh} title="Look for installed agent CLIs again, for one you just installed">
              {pass?.looking ? "Looking…" : "Refresh agents"}
            </button>
          )}
          <button className="btn primary" disabled={!ready} onClick={() => onStart(seats)} title={ready ? "Start every seat" : !searched ? "Waiting for a search for agents that succeeds" : "Pick an AI and a model (or Terminal) for every seat first"}>
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
    </section>
  );
}
