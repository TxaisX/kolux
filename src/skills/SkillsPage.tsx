// SKILL-017: the Skills page. Every skill the AIs on this computer can see, with search, a Filter
// by agent menu, source chips with counts, Refresh, Clear filters and a Skill folders popover.
// Close (or Escape outside a text field) goes back to whichever view was open before.
// SKILL-022: More actions > Delete skills chooses rows (bundled and plugin rows cannot be chosen),
// confirms with what goes and where linked content stays, then shows each skill's outcome.
// SKILL-020: each row's actions (View details, Reveal file, Copy path, Delete) and a details dialog
// with the AIs that see the skill, when it was updated and its path; Delete goes through SKILL-022.
// SKILL-024 / SKILL-026: SkillUpdate shows the out-of-date notice and the background update dialog.
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Close, Dots, Funnel, Refresh } from "../chrome/icons";
import { locale } from "../language";
import Ask from "../chrome/Ask";
import { overlayShowing } from "../chrome/fullPage";
import SkillUpdate from "./SkillUpdate";
import { focusFirst, focusLost, onMenuKey, returnFocus } from "./menuFocus";
import { INSTALL_DETAIL, SKILLS_SHOW_EVENT } from "./skillBarStore";
import SkillPill from "./SkillPill";
import { pillFor, type Load } from "./skillBar";
import type { Checked } from "./updateNotice";
import { AGENT_FILTERS, COPIED, COPY_FAILED, MAX_DELETE, ROW_ACTIONS, actionBlocked, INSTALL_ITEM, installBlocked, pageEscape, pageOverlay, seenBy, NO_DESCRIPTION, NO_FILTERS, QUERY_LIMIT, SOURCES, dateText, deleteBlocked, eligible, filtersOn, keepChosen, outcomeText, pickOf, rootState, shortPath, sourceCounts, sumUp, viewOf, visible, whyNot, type Done, type Filters, type Planned, type RowAction, type Scan, type Skill } from "./skills";

type Asking = { kind: "confirm"; plan: Planned[] } | { kind: "done"; done: Done[] } | { kind: "error"; text: string };

type Props = { workspace: string | null; onClose: () => void };

export default function SkillsPage({ workspace, onClose }: Props) {
  const [scan, setScan] = useState<Scan | null>(null);
  // SKILL-025: what the last update check found, for the freshness pills.
  const [fresh, setFresh] = useState<{ load: Load; checked: Checked | null }>({ load: "idle", checked: null });
  const [failed, setFailed] = useState<string | null>(null);
  const [scanning, setScanning] = useState(true);
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [tooLong, setTooLong] = useState(false);
  const [open, setOpen] = useState<"agent" | "folders" | "more" | null>(null);
  const run = useRef(0);
  const page = useRef<HTMLElement>(null);
  // UX audit skills-automations.md:19: a menu takes focus when it opens and gives it back to its button when it closes.
  const opener = useRef<HTMLElement | null>(null);
  const opens = (e: { currentTarget: HTMLElement }) => void (opener.current = e.currentTarget);
  /** SKILL-022: the chosen rows' paths while choosing skills to delete; null otherwise. */
  const [picking, setPicking] = useState<string[] | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [working, setWorking] = useState(false);
  /** SKILL-020: the row whose actions menu is open, the skill whose details show, and the toast. */
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [details, setDetails] = useState<Skill | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flash = (text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const load = (refresh: boolean) => {
    const n = ++run.current;
    setScanning(true);
    setFailed(null);
    invoke<Scan>("skills_scan", { workspace, refresh }).then(
      (s) => n === run.current && (setScan(s), setScanning(false)),
      (e) => n === run.current && (setFailed(String(e)), setScanning(false)),
    );
  };
  useEffect(() => load(false), [workspace]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // A dialog showing on the page (the Update dialog) owns the key: the page never closes underneath it.
      const step = pageEscape({ menu: open !== null, rowMenu: rowMenu !== null, picking: picking !== null, overlay: pageOverlay([asking, details], () => overlayShowing(page.current ?? document)) }, e.target);
      if (step === "menu") setOpen(null);
      else if (step === "row-menu") setRowMenu(null);
      else if (step === "picking") setPicking(null);
      else if (step === "close") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, rowMenu, picking, asking, details, onClose]);

  const skills = scan?.skills ?? [];
  const shown = useMemo(() => visible(skills, f), [skills, f]);
  const counts = useMemo(() => sourceCounts(skills, f), [skills, f]);
  const view = viewOf(scan, failed, scanning, shown.length);
  const errors = scan?.roots.filter((r) => r.state === "error") ?? [];
  const agentLabel = AGENT_FILTERS.find((a) => a.id === f.agent)!.label;
  const menuOn = open === "agent" || open === "more" || rowMenu !== null;
  const heading = useRef<HTMLHeadingElement>(null);
  const busyWas = useRef(false);
  const busy = menuOn || asking !== null || details !== null;
  useEffect(() => {
    // A menu or dialog just closed. Focus lost with it goes back to the button that opened it, or, when that button is gone
    // (its row was deleted), to the page heading, so the next Escape does not close the whole page. Focus a dialog or
    // field already took stays where it is.
    const ended = busyWas.current && !busy;
    busyWas.current = busy;
    if (ended && focusLost(document.activeElement, document.body)) returnFocus(opener.current, [() => heading.current]);
  }, [busy]);
  // A scan that failed shows no rows to choose, so a selection in progress ends.
  useEffect(() => {
    if (view === "failed") setPicking(null);
  }, [view]);
  // A rescan drops choices that vanished or can no longer be chosen.
  useEffect(() => setPicking((p) => p && keepChosen(p, skills)), [scan]);
  const nameOf = (path: string) => skills.find((s) => s.path === path)?.name ?? shortPath(path, 40);
  const picksOf = (paths: string[]) => skills.filter((s) => paths.includes(s.path)).map(pickOf);

  /** SKILL-022: plans the delete of `paths` and opens its confirmation (T-320's row Delete too). */
  const askDelete = (paths: string[]) => {
    if (paths.length === 0 || paths.length > MAX_DELETE || working) return;
    setWorking(true);
    invoke<Planned[]>("skills_delete_plan", { workspace, picks: picksOf(paths) })
      .then((plan) => setAsking({ kind: "confirm", plan }), (e) => setAsking({ kind: "error", text: String(e) }))
      .finally(() => setWorking(false));
  };
  const confirmDelete = (paths: string[]) => {
    setAsking(null);
    setWorking(true);
    invoke<Done[]>("skills_delete", { workspace, picks: picksOf(paths) })
      .then((done) => setAsking({ kind: "done", done: done.map((d) => ({ ...d, path: nameOf(d.path) })) }), // named before the rescan drops them
       (e) => setAsking({ kind: "error", text: String(e) }))
      .finally(() => {
        setWorking(false);
        setPicking(null);
        load(true);
      });
  };
  /** SKILL-020: one row action. Copy runs inside the click, so the clipboard accepts it. */
  const act = (s: Skill, a: RowAction) => {
    setRowMenu(null);
    if (actionBlocked(s, a)) return;
    if (a === "details") setDetails(s);
    else if (a === "reveal") invoke("skills_reveal", { workspace, path: s.path }).catch((e) => flash(String(e)));
    else if (a === "delete") {
      setDetails(null);
      askDelete([s.path]);
    } else {
      try {
        navigator.clipboard.writeText(s.path).then(() => flash(COPIED), () => flash(COPY_FAILED));
      } catch {
        flash(COPY_FAILED);
      }
    }
  };
  const toggle = (path: string) => setPicking((p) => p && (p.includes(path) ? p.filter((x) => x !== path) : [...p, path]));

  const clear = () => {
    setF(NO_FILTERS);
    setTooLong(false);
  };

  return (
    <section ref={page} className="skills" aria-label="Skills">
      <header className="skills-head">
        <button className="ib" title="Close (Escape)" aria-label="Close Skills" onClick={onClose}>
          <Close size={14} />
        </button>
        <h2 ref={heading} tabIndex={-1} style={{ outline: "none" }}>
          Skills
        </h2>
        <span className="skills-sub">{scan ? `${skills.length} skill${skills.length === 1 ? "" : "s"}` : ""}</span>
        <span className="spacer" />
        <button
          className="ib"
          title="More actions"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={open === "more"}
          onClick={(e) => {
            opens(e);
            setOpen(open === "more" ? null : "more");
          }}
        >
          <Dots size={14} />
        </button>
        {open === "more" && (
          <>
            <div className="menu-backdrop" onClick={() => setOpen(null)} />
            <div className="menu skills-pop right" role="menu" aria-label="More actions" ref={focusFirst} onKeyDown={onMenuKey}>
              <button
                className="menu-item"
                role="menuitem"
                disabled={installBlocked(scan) !== null}
                title={installBlocked(scan) ?? undefined}
                onClick={() => {
                  // Back to the button first, so the dialog gives focus back to it when it closes.
                  opener.current?.focus();
                  setOpen(null);
                  window.dispatchEvent(new CustomEvent(SKILLS_SHOW_EVENT, { detail: INSTALL_DETAIL }));
                }}
              >
                <span className="name">{INSTALL_ITEM}</span>
              </button>
              <button
                className="menu-item"
                role="menuitem"
                disabled={deleteBlocked(scan, view) !== null}
                title={deleteBlocked(scan, view) ?? undefined}
                onClick={() => {
                  setPicking([]);
                  setOpen(null);
                }}
              >
                <span className="name">Delete skills</span>
              </button>
            </div>
          </>
        )}
      </header>

      <div className="skills-bar">
        <input
          className="picker-input skills-search"
          placeholder="Search skills"
          aria-label="Search skills"
          value={f.query}
          onChange={(e) => {
            const q = e.target.value;
            if (q.length > QUERY_LIMIT) {
              setTooLong(true);
              return;
            }
            setTooLong(false);
            setF({ ...f, query: q });
          }}
        />
        <div className="skills-anchor">
          <button className={`btn${f.agent !== "all" ? " on" : ""}`} aria-haspopup="menu" aria-expanded={open === "agent"} onClick={(e) => (opens(e), setOpen(open === "agent" ? null : "agent"))}>
            <Funnel size={12} /> {f.agent === "all" ? "Filter by agent" : agentLabel}
          </button>
          {open === "agent" && (
            <>
              <div className="menu-backdrop" onClick={() => setOpen(null)} />
              <div className="menu skills-pop" role="menu" aria-label="Filter by agent" ref={focusFirst} onKeyDown={onMenuKey}>
                {AGENT_FILTERS.map((a) => (
                  <button
                    key={a.id}
                    className="menu-item"
                    role="menuitemradio"
                    aria-checked={f.agent === a.id}
                    onClick={() => {
                      setF({ ...f, agent: a.id });
                      setOpen(null);
                    }}
                  >
                    <span className="tick">{f.agent === a.id ? "✓" : ""}</span>
                    <span className="name">{a.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="skills-chips" role="group" aria-label="Where skills come from">
          {SOURCES.map((s) => {
            const on = f.sources.includes(s.id);
            return (
              <button key={s.id} className={`skills-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => setF({ ...f, sources: on ? f.sources.filter((x) => x !== s.id) : [...f.sources, s.id] })}>
                {s.label} <span className="n">{counts[s.id]}</span>
              </button>
            );
          })}
        </div>
        <span className="spacer" />
        {filtersOn(f) && (
          <button className="btn" onClick={clear}>
            Clear filters
          </button>
        )}
        <div className="skills-anchor">
          <button className="btn" aria-haspopup="dialog" aria-expanded={open === "folders"} onClick={() => setOpen(open === "folders" ? null : "folders")}>
            Skill folders
          </button>
          {open === "folders" && (
            <>
              <div className="menu-backdrop" onClick={() => setOpen(null)} />
              <div className="menu skills-pop right skills-folders" role="dialog" aria-label="Skill folders">
                <div className="menu-title">Folders scanned</div>
                {(scan?.roots ?? []).map((r, i) => (
                  <div key={i} className={`skills-root ${r.state}`}>
                    <div className="label">
                      <span className="name">{r.label}</span>
                      <span className="state">{rootState(r)}</span>
                    </div>
                    {r.path && r.source !== "bundled" && (
                      <div className="path" title={r.path}>
                        {shortPath(r.path, 56)}
                      </div>
                    )}
                  </div>
                ))}
                {!scan && <div className="menu-hint">Not scanned yet.</div>}
              </div>
            </>
          )}
        </div>
        <button className="btn" title="Scan every folder again" onClick={() => load(true)} disabled={scanning}>
          <Refresh size={12} /> Refresh
        </button>
      </div>
      {picking && (
        <div className="skills-bar skills-picking" role="toolbar" aria-label="Choose skills to delete">
          <span role="status">{picking.length} selected</span>
          <button className="btn" onClick={() => setPicking(eligible(shown))}>
            Select all eligible
          </button>
          <button className="btn" onClick={() => setPicking([])} disabled={picking.length === 0}>
            Clear
          </button>
          <span className="spacer" />
          {picking.length > MAX_DELETE && <span className="skills-note">At most {MAX_DELETE} skills at a time</span>}
          <button className="btn danger" disabled={picking.length === 0 || picking.length > MAX_DELETE || working} onClick={() => askDelete(picking)}>
            Delete…
          </button>
          <button className="btn" onClick={() => setPicking(null)}>
            Exit selection
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      <SkillUpdate workspace={workspace} onFreshness={(l, c) => setFresh({ load: l, checked: c })} onChanged={() => load(true)} bundled={skills.filter((s) => s.source === "bundled").map((s) => s.name)} />
      {tooLong && <div className="skills-note" role="status">That search is too long; searches are at most {QUERY_LIMIT} characters.</div>}

      <div className="skills-body">
        {view === "scanning" && <div className="empty"><p>Scanning skill folders…</p></div>}
        {view === "failed" && (
          <div className="empty" role="alert">
            <h2>Scan failed</h2>
            {failed && <p>{failed}</p>}
            {errors.map((r, i) => (
              <p key={i} className="skills-err">
                {r.label}: {r.note ?? "could not be read"}
              </p>
            ))}
            <p>A folder that cannot be read is never shown as fewer skills.</p>
            <button className="btn" onClick={() => load(true)} disabled={scanning}>
              Retry
            </button>
          </div>
        )}
        {view === "empty" && (
          <div className="empty">
            <h2>No skills found</h2>
            <p>None of the skill folders holds a skill yet.</p>
            <button className="btn" onClick={() => load(true)}>
              Refresh
            </button>
          </div>
        )}
        {view === "no-matches" && (
          <div className="empty">
            <h2>No matches</h2>
            <p>No skill fits the search and filters.</p>
            <button className="btn" onClick={clear}>
              Clear filters
            </button>
          </div>
        )}
        {view === "list" && (
          <div className="skills-list" role="list">
            {shown.map((s) => (
              <div key={s.path} className="skills-row" role="listitem">
                <div className="top">
                  {picking && (
                    <label className="hit-box">
                      <input
                        type="checkbox"
                        aria-label={`Choose ${s.name}`}
                        checked={picking.includes(s.path)}
                        disabled={whyNot(s) != null}
                        title={whyNot(s) ?? undefined}
                        onChange={() => toggle(s.path)}
                      />
                    </label>
                  )}
                  <span className="name">{s.name}</span>
                  <span className={`skills-tag ${s.source}`}>{s.plugin ? `Plugin: ${s.plugin}` : SOURCES.find((x) => x.id === s.source)!.label}</span>
                  <span className="spacer" />
                  {s.source === "bundled" && <SkillPill pill={pillFor(s.name, fresh.load, fresh.checked)} />}
                  <span className={`date${s.updated == null ? " none" : ""}`}>{s.source === "bundled" ? "Built into Kolux" : dateText(s.updated, locale())}</span>
                  <div className="skills-anchor">
                    <button className="ib" title="Skill actions" aria-label={`Actions for ${s.name}`} aria-haspopup="menu" aria-expanded={rowMenu === s.path} onClick={(e) => (opens(e), setRowMenu(rowMenu === s.path ? null : s.path))}>
                      <Dots size={12} />
                    </button>
                    {rowMenu === s.path && (
                      <>
                        <div className="menu-backdrop" onClick={() => setRowMenu(null)} />
                        <div className="menu skills-pop right" role="menu" aria-label={`Actions for ${s.name}`} ref={focusFirst} onKeyDown={onMenuKey}>
                          {ROW_ACTIONS.map((a) => (
                            <button key={a.id} className="menu-item" role="menuitem" disabled={actionBlocked(s, a.id) != null} title={actionBlocked(s, a.id) ?? undefined} onClick={() => act(s, a.id)}>
                              <span className="name">{a.label}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className={`desc${s.description ? "" : " none"}`}>{s.description ?? NO_DESCRIPTION}</div>
                {s.source !== "bundled" && (
                  <div className="path" title={s.path}>
                    {shortPath(s.path)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {details && (
        <Ask
          title={details.name}
          confirm={null}
          body={
            <>
              <p>Used by: {seenBy(details).join(", ") || "No AI reads this folder"}</p>
              <p>Last updated: {details.source === "bundled" ? "Built into Kolux" : dateText(details.updated, locale())}</p>
              {details.source !== "bundled" && (
                <>
                  <p title={details.path} style={{ userSelect: "text", wordBreak: "break-all", fontFamily: "var(--mono-font)" }}>
                    {details.path}
                  </p>
                  <p>
                    <button className="btn" onClick={() => act(details, "copy")}>
                      Copy path
                    </button>{" "}
                    <button className="btn" onClick={() => act(details, "reveal")}>
                      Reveal file
                    </button>{" "}
                    <button className="btn danger" disabled={actionBlocked(details, "delete") != null} title={actionBlocked(details, "delete") ?? undefined} onClick={() => act(details, "delete")}>
                      Delete
                    </button>
                  </p>
                </>
              )}
            </>
          }
          onConfirm={() => setDetails(null)}
          onCancel={() => setDetails(null)}
        />
      )}
      {asking?.kind === "confirm" && (() => {
        const sum = sumUp(asking.plan, nameOf);
        return (
          <Ask
            title={sum.count === 0 ? "Nothing to delete" : `Delete ${sum.count} skill${sum.count === 1 ? "" : "s"}?`}
            confirm={sum.count === 0 ? null : "Delete"}
            body={
              <>
                <p>{sum.headline}</p>
                {sum.remains.map((r, i) => (
                  <p key={i}>{r}</p>
                ))}
                {sum.dangling.map((d, i) => (
                  <p key={`d${i}`}>{d}</p>
                ))}
                {sum.blocked.length > 0 && (
                  <>
                    <p>Left alone:</p>
                    <ul className="ask-list">
                      {sum.blocked.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  </>
                )}
                {sum.count > 0 && <p>This cannot be undone.</p>}
              </>
            }
            onConfirm={() => confirmDelete(asking.plan.filter((p) => !p.blocked).map((p) => p.path))}
            onCancel={() => setAsking(null)}
          />
        );
      })()}
      {asking?.kind === "done" && (
        <Ask
          title="Delete finished"
          confirm={null}
          body={
            <ul className="ask-list">
              {asking.done.map((d, i) => (
                <li key={i}>
                  {d.path}: {outcomeText(d)}
                </li>
              ))}
            </ul>
          }
          onConfirm={() => setAsking(null)}
          onCancel={() => setAsking(null)}
        />
      )}
      {asking?.kind === "error" && <Ask title="Delete did not run" confirm={null} body={<p>{asking.text}</p>} onConfirm={() => setAsking(null)} onCancel={() => setAsking(null)} />}
    </section>
  );
}
