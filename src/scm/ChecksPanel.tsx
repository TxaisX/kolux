// VIEW-073: the Checks tab of the right sidebar. It follows the worktree of the focused terminal and
// shows that branch's pull request: a review header, a merge conflict notice when there is one, and
// every check, each opening to its details. Running checks are asked about again while the tab is in
// view; Refresh asks at once. A branch with no pull request says so, and that answer is reused for a
// short while instead of asking gh again.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { Refresh } from "../chrome/icons";
import { fixChecks } from "../agentstart/host";
import { openInBrowser } from "../browser/openIn";
import { useSettings } from "../settings/useSettings";
import GhBanner, { classify } from "../tasks/GhBanner";
import CommentsPanel from "./CommentsPanel";
import ConflictPanel from "./ConflictPanel";
import PrStart from "./PrStart";
import StackMap from "./StackMap";
import { REFRESH, RERUN, openLinkFailed, stackKey, stillCurrent } from "./panelUx";
import "./scmUx.css";
import { checkIdOf, type CheckRef } from "./checkCard";
import { reviewHint, reviewWhere } from "./startPr";
import { CHECKS_POLL_MS, CHECKS_UNLINKED_KEY, checksSummary, panelBody, reusableNoPr, reuseNoPr, showing, stillRunning, unlinkedPrs, withUnlinkedPr, type PrChecks } from "./checks";
import { prStateWord } from "./model";
import { recordChecks } from "./prSearch";
import { CHECK_CAP, capped, checkGroups } from "./review";
import type { Check } from "./checks";

type Props = { dir: string | null; linked: string | null; visible: boolean; /** T-235-b: opens a check as its own tab; without it the rows have no Open button. */ onOpenCheck?: (check: CheckRef) => void };

/** When each worktree last answered "no pull request", kept across tab switches. */
const noPrSeen = new Map<string, number>();

const GROUPS = [
  ["failing", "Failing"],
  ["pending", "Pending"],
  ["passing", "Passing"],
  ["other", "Not counted"],
] as const;

const when = (t?: string | null) => (t ? new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : null);

export default function ChecksPanel({ dir, linked, visible, onOpenCheck }: Props) {
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [rerunning, setRerunning] = useState<string | null>(null); // the check whose rerun is still being asked for
  const { settings, save } = useSettings();
  const inKolux = settings?.linksOpenInKolux === true;
  /** A link that will not open says so in the note, never silently. */
  const openOut = (url: string) => void invoke("open_external", { url }).catch((err) => setNote({ text: openLinkFailed(err), error: true }));
  const rerun = (c: Check) => {
    if (rerunning !== null) return;
    setNote(null);
    const at = asking.current; // the folder this click was made in; an answer that comes back after a switch is dropped
    const id = c.link ?? c.name;
    setRerunning(id);
    invoke("scm_check_rerun", { worktree: dir, link: c.link, failedOnly: true })
      .then(() => {
        if (!stillCurrent(asking.current, at)) return;
        setNote({ text: `Asked GitHub to rerun ${c.name}`, error: false });
        load(true); // the checks go back to running, so read them again
      })
      .catch((err) => stillCurrent(asking.current, at) && setNote({ text: String(err), error: true }))
      .finally(() => setRerunning((r) => (r === id ? null : r)));
  };
  const key = dir === null ? null : `${dir}|${linked ?? ""}`;
  const [got, setGot] = useState<{ key: string; data: PrChecks | null; error: string | null; loading: boolean } | null>(null);
  const asking = useRef<string | null>(null);
  asking.current = key;
  // The answer on screen is only ever this worktree's; an older one never stands in for it.
  const shown = got && got.key === key ? got : null;

  const load = (force: boolean) => {
    if (key === null || dir === null) return;
    if (!force && reuseNoPr(noPrSeen, key, Date.now())) return setGot({ key, data: { pr: null, conflict: false, checks: [] }, error: null, loading: false });
    setGot((g) => (g && g.key === key ? { ...g, loading: true } : { key, data: null, error: null, loading: true }));
    invoke<PrChecks>("scm_pr_checks", { worktree: dir, linked })
      .then((data) => {
        recordChecks(dir, data); // VIEW-043: the palette reads the same answer
        if (asking.current !== key) return;
        if (reusableNoPr(data)) noPrSeen.set(key, Date.now());
        else noPrSeen.delete(key);
        setGot({ key, data, error: null, loading: false });
      })
      .catch((err) => asking.current === key && setGot((g) => ({ key, data: g?.key === key ? g.data : null, error: String(err), loading: false })));
  };

  useEffect(() => {
    setNote(null); // a note belongs to the folder it was made in
    if (visible) load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, visible]);
  // Polling runs only while the tab is in view and a check is still running.
  const running = !!shown?.data && stillRunning(shown.data.checks);
  useEffect(() => {
    if (!visible || !running || shown?.loading) return;
    const t = setTimeout(() => load(true), CHECKS_POLL_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, running, shown?.loading, key]);

  const data = shown?.data ?? null;
  // VIEW-073: a pull request the host reports as unlinked is hidden; one the user unlinked stays hidden behind a notice.
  const unlinkedAll = unlinkedPrs(settings?.[CHECKS_UNLINKED_KEY]);
  const view = data ? showing(data.pr, dir === null ? undefined : unlinkedAll[dir]) : null;
  const pr = view?.kind === "pr" ? view.pr : null;
  const unlink = () => dir !== null && pr && void save({ [CHECKS_UNLINKED_KEY]: withUnlinkedPr(unlinkedAll, dir, { number: pr.number, url: pr.url }) });
  const linkAgain = () => dir !== null && void save({ [CHECKS_UNLINKED_KEY]: withUnlinkedPr(unlinkedAll, dir, null) });
  /** The check as a tab keeps it; null for a check with no run address to read (an outside service). */
  const opened = (c: Check): CheckRef | null => {
    const id = checkIdOf(c.link);
    return id === null || !c.link ? null : { id, name: c.name, link: c.link, outcome: c.outcome, workflow: c.workflow, pr: pr ? { number: pr.number, url: pr.url, state: pr.state } : null };
  };
  const body = panelBody({ dir, error: shown?.error ?? null, data, view: view?.kind ?? null });
  return (
    <aside className="sidebar-wrap right">
      <div className="sidebar scm checks-panel">
        <div className="sb-section scm-head">
          <span>Checks</span>
          {pr && <span className="count">{data!.checks.length}</span>}
          <div className="icons">
            {dir !== null && (
              <button className="ib" title={shown?.loading ? "Looking…" : `${REFRESH} the checks`} aria-label={`${REFRESH} the checks`} disabled={!!shown?.loading} aria-busy={!!shown?.loading} onClick={() => load(true)}>
                <Refresh className={shown?.loading ? "spin" : undefined} />
              </button>
            )}
          </div>
        </div>
        {dir === null ? (
          <div className="sb-hint">Open a workspace to see its pull request's checks.</div>
        ) : body === "error" ? (
          classify(shown!.error!) !== "other" ? (
            <GhBanner error={shown!.error!} onRetry={() => load(true)} />
          ) : (
            <div className="note error">The checks could not be read: {shown!.error}</div>
          )
        ) : !data ? (
          <div className="sb-hint">Looking for this branch's pull request…</div>
        ) : view?.kind === "unlinked" ? (
          <div className="note checks-unlinked" data-unlinked>
            Pull request #{view.pr.number} is unlinked from this workspace, so its checks and comments are hidden.{" "}
            <button className="btn" data-link-again onClick={linkAgain}>
              Link again
            </button>
          </div>
        ) : body === "start" || !pr ? (
          <PrStart dir={dir} provider={data.provider} host={data.host} onCreated={() => load(true)} />
        ) : (
          <>
            <div className="scm-prrow checks-review">
              <span className={`scm-prstate ${pr.state.toLowerCase()}`}>{prStateWord(pr)}</span>
              <a
                className="scm-prtitle"
                href={pr.url}
                data-review-link
                title={`${pr.title ?? ""}
${reviewHint(inKolux)}`.trim()}
                onClick={(e) => {
                  e.preventDefault();
                  if (reviewWhere(e, inKolux) === "kolux") openInBrowser(pr.url);
                  else openOut(pr.url);
                }}
              >
                #{pr.number} {pr.title}
              </a>
              <span className="sb-hint" data-review-hint>
                {reviewHint(inKolux)}
              </span>
              <button className="btn" data-unlink title="Hide this pull request from the Checks tab until you link it again" onClick={unlink}>
                Unlink
              </button>
            </div>
            <StackMap key={stackKey(dir, pr.number)} dir={dir} pr={pr} />
            {data.conflict && <ConflictPanel dir={dir} url={pr.url} />}
            <div className="sb-hint checks-sum">{checksSummary(data.checks)}</div>
            {note && (
              <div className={note.error ? "note error" : "note"} role={note.error ? "alert" : "status"}>
                {note.text}
              </div>
            )}
            {(() => {
              const groups = checkGroups(data.checks);
              const cap = capped(data.checks, CHECK_CAP, "checks");
              // GIT-029: only the first 100 checks are drawn, in their groups, with a note for the rest.
              const drawn = new Set(cap.shown);
              return (
                <div className="checks-list">
                  {GROUPS.map(([key, label]) => {
                    const rows = groups[key].filter((c) => drawn.has(c));
                    if (rows.length === 0) return null;
                    return (
                      <section key={key} className={`check-group ${key}`} data-group={key}>
                        <h4 className="check-group-title">
                          {label} <span className="count">{groups[key].length}</span>
                          {key === "failing" && (
                            <button className="btn" data-fix-checks title="Start an agent on the failing checks of this pull request" onClick={() => void fixChecks({ dir, pr, checks: data.checks })}>
                              Fix with AI
                            </button>
                          )}
                        </h4>
                        {rows.map((c, i) => (
                          <details key={`${c.name}-${i}`} className="check-row" data-outcome={c.outcome}>
                            <summary>
                              <span className={`check-dot ${c.outcome}`} aria-hidden="true" />
                              <span className="name" title={c.name}>
                                {c.name}
                              </span>
                              {c.workflow && <span className="wf">{c.workflow}</span>}
                              <span className={`word ${c.outcome}`}>{c.outcome}</span>
                              {onOpenCheck && opened(c) && (
                                <button
                                  className="btn"
                                  data-open-check
                                  title="Open this check's steps and annotations in a tab"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onOpenCheck(opened(c)!);
                                  }}
                                >
                                  Open
                                </button>
                              )}
                            </summary>
                            <div className="check-detail">
                              {c.description && <div>{c.description}</div>}
                              {when(c.started) && <div>Started {when(c.started)}</div>}
                              {when(c.finished) && <div>Finished {when(c.finished)}</div>}
                              {c.outcome === "unresolved" && <div>It finished without reporting an outcome.</div>}
                              {c.outcome === "neutral" && <div>It finished neutral, which is not counted as passed.</div>}
                              {c.link && (
                                <button className="btn" onClick={() => openOut(c.link!)}>
                                  Open the check's page
                                </button>
                              )}
                              {c.outcome === "failed" && c.link && (
                                <button className="btn" data-rerun disabled={rerunning !== null} title="Ask GitHub to run this check's failed jobs again" onClick={() => rerun(c)}>
                                  {rerunning === c.link ? "Asking…" : RERUN}
                                </button>
                              )}
                            </div>
                          </details>
                        ))}
                      </section>
                    );
                  })}
                  {cap.note && <div className="sb-hint">{cap.note}</div>}
                </div>
              );
            })()}
            <CommentsPanel dir={dir} url={pr.url} visible={visible} />
          </>
        )}
      </div>
    </aside>
  );
}
