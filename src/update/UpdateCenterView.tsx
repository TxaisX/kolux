// APP-024..027 on screen: the quiet timetable, the automatic download, the update card a requested check
// brings up, and the one notice ("A new Kolux RS version is out on GitHub." with Update now / Later) that
// appears once the update has downloaded. Both sit in the bottom-left corner (update.css), clear of the
// status bar, and none depends on any sidebar element.
import { useEffect, useReducer, useRef, useState } from "react";
import "./update.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Ask from "../chrome/Ask";
import { Close, Refresh, Spinner, CheckCircle } from "../chrome/icons";
import { TICK_MS, UpdateSchedule, type Outcome } from "./schedule";
import { actionLabel, barItem, cardReducer, initialCard, isQuiet, mainAction, popupEscapes, RESTART_ASK, RESTART_TIP, restartingLabel, SHORT_RECHECK_MS, STALE_MARK, tipVisible, type UpdateInfo } from "./card";
import { BAR_EVENT, CHECK_EVENT, SHOW_EVENT, setBar } from "./bus";

interface Status {
  enabled: boolean;
  reason: string | null;
  currentVersion: string;
  lastCheckAt: number | null;
  dismissedVersion: string | null;
  tipDone: boolean;
  ready: UpdateInfo | null;
}

const FADE_MS = 2500;

export default function UpdateCenterView() {
  const [s, dispatch] = useReducer(cardReducer, initialCard(null, true));
  const status = useRef<Status | null>(null);
  const schedule = useRef<UpdateSchedule<UpdateInfo> | null>(null);
  const downloading = useRef<string | null>(null);
  const cardEl = useRef<HTMLDivElement | null>(null);
  const recheck = useRef(0);
  // A check asked for before update_status answered waits here and runs the moment it does.
  const askedEarly = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [restarting, setRestarting] = useState(false);
  // T-600: counts the user's own clicks that open the card (Check for updates, the status-bar item, the
  // card's expand); only a new one moves the keyboard to the card.
  const [clicks, clicked] = useReducer((n: number) => n + 1, 0);

  const download = (info: UpdateInfo) => {
    // A requested check that finds the update already downloading shows that download.
    dispatch({ type: "downloadStart", info });
    if (downloading.current === info.version) return;
    downloading.current = info.version;
    invoke<UpdateInfo>("update_download").then(
      (done) => {
        downloading.current = null;
        dispatch({ type: "ready", info: { ...done, notes: done.notes.length ? done.notes : info.notes } });
      },
      (e) => {
        downloading.current = null;
        dispatch({ type: "downloadFailed", info, message: String(e), offline: !navigator.onLine });
      },
    );
  };

  const onOutcome = (o: Outcome<UpdateInfo>, requested: boolean) => {
    if (o.ok) {
      dispatch({ type: "checkDone", requested, found: o.found });
      if (o.found) download(o.found); // APP-024/025: the download starts by itself
    } else if (o.error === STALE_MARK) {
      // T-199: a newer check already replaced this one; its answer is the one that counts.
    } else if (o.error !== "offline") {
      // T-199 (APP-031): a half-published release is looked at again soon, without a word on a quiet check.
      if (isQuiet(o.error) && !recheck.current) recheck.current = window.setTimeout(() => ((recheck.current = 0), void schedule.current?.run(false)), SHORT_RECHECK_MS);
      dispatch({ type: "checkFailed", requested, message: o.error, offline: o.offline });
    }
  };

  const check = () => {
    const st = status.current;
    clicked(); // the user's click: the card that comes up takes the keyboard
    dispatch({ type: "checkStart", requested: true });
    if (!st) {
      askedEarly.current = true; // "Checking for updates…" shows now; the check itself runs once the status is known
      return;
    }
    if (!st.enabled || !schedule.current) {
      dispatch({ type: "checkFailed", requested: true, message: st.reason ?? "Updates are off in this copy.", offline: false, next: "Install Kolux RS from its releases page to get updates." });
      return;
    }
    void schedule.current.run(true);
  };

  useEffect(() => {
    let alive = true;
    const offs: Array<() => void> = [];
    void invoke<Status>("update_status").then((st) => {
      if (!alive) return;
      status.current = st;
      // Start from what the store remembers.
      dispatch({ type: "hydrate", dismissed: st.dismissedVersion, tipDone: st.tipDone });
      if (st.ready) dispatch({ type: "ready", info: st.ready });
      const early = askedEarly.current;
      askedEarly.current = false;
      if (!st.enabled) {
        if (early) check();
        return;
      }
      const sched = new UpdateSchedule<UpdateInfo>(
        {
          now: () => Date.now(),
          setTimer: (fn, ms) => window.setTimeout(fn, ms),
          clearTimer: (h) => window.clearTimeout(h as number),
          online: () => navigator.onLine,
          check: () => {
            dispatch({ type: "checkStart", requested: false });
            return invoke<UpdateInfo | null>("update_check");
          },
          onOutcome,
        },
        st.lastCheckAt,
      );
      schedule.current = sched;
      sched.start();
      const tick = window.setInterval(() => sched.tick(), TICK_MS);
      const onFocus = () => sched.focus();
      const onOnline = () => sched.online();
      window.addEventListener("focus", onFocus);
      window.addEventListener("online", onOnline);
      offs.push(() => {
        window.clearInterval(tick);
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("online", onOnline);
        sched.stop();
      });
      if (early) check();
    }).catch((e) => {
      if (alive && askedEarly.current) {
        askedEarly.current = false;
        dispatch({ type: "checkFailed", requested: true, message: String(e), offline: !navigator.onLine });
      }
    });
    const unlisten = listen<{ version: string; received: number; total: number | null }>("update-progress", (e) =>
      dispatch({ type: "progress", version: e.payload.version, received: e.payload.received, total: e.payload.total }),
    );
    const onAsk = () => check();
    window.addEventListener(CHECK_EVENT, onAsk);
    return () => {
      alive = false;
      window.clearTimeout(recheck.current);
      offs.forEach((f) => f());
      void unlisten.then((f) => f());
      window.removeEventListener(CHECK_EVENT, onAsk);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setBar(barItem(s.phase));
    window.dispatchEvent(new Event(BAR_EVENT));
  }, [s.phase]);
  useEffect(() => {
    const onShow = () => (clicked(), dispatch({ type: "show" }));
    window.addEventListener(SHOW_EVENT, onShow);
    return () => window.removeEventListener(SHOW_EVENT, onShow);
  }, []);

  // Escape closes the ready notice (Later) even though it never takes the keyboard.
  useEffect(() => {
    if (!s.popup || confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (popupEscapes(e)) dispatch({ type: "popupClose" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s.popup, confirming]);

  // Up to date: the card closes itself.
  useEffect(() => {
    if (s.phase.kind !== "upToDate") return;
    const t = window.setTimeout(() => dispatch({ type: "faded" }), FADE_MS);
    return () => window.clearTimeout(t);
  }, [s.phase.kind]);

  // What the store remembers follows the card.
  useEffect(() => {
    if (s.dismissed && s.dismissed !== status.current?.dismissedVersion) {
      void invoke("update_mark", { key: "dismissedVersion", value: s.dismissed }).catch(() => {});
      if (status.current) status.current.dismissedVersion = s.dismissed;
    }
  }, [s.dismissed]);
  useEffect(() => {
    if (s.tipDone && status.current && !status.current.tipDone) {
      status.current.tipDone = true;
      void invoke("update_mark", { key: "tipDone", value: "1" }).catch(() => {});
    }
  }, [s.tipDone]);

  // The card takes the keyboard when it opens on the user's click, so Escape and Enter reach it. T-600: only
  // then, once that click has drawn it; a change of phase, a quiet check or a download error never takes it.
  useEffect(() => {
    if (clicks) cardEl.current?.focus();
  }, [clicks]);
  const expand = () => (clicked(), dispatch({ type: "expand" }));

  // On success the app ends here and the installer takes over; a failure means nothing is ready any more.
  // T-199 (APP-029): an installer that cannot start leaves the app open with the real reason.
  const restart = () => {
    setConfirming(false);
    setRestarting(true); // the button reads Restarting… and stays off until the app ends or the restart fails
    void invoke("update_restart").catch((e) => {
      const message = String(e);
      setRestarting(false);
      dispatch(message === "No update is ready." ? { type: "notReady" } : { type: "restartFailed", message });
    });
  };
  // Restarting ends every terminal and agent, so every route to it asks first.
  const askRestart = () => {
    if (!restarting) setConfirming(true);
  };
  // T-199 (APP-031): compatibility mode is remembered, then the check runs again.
  const compat = () => void invoke("update_compat", { on: true }).then(check, check);
  const act = () => {
    const a = mainAction(s.phase);
    if (a === "close") dispatch({ type: s.phase.kind === "error" ? "dismiss" : "faded" });
    else if (a === "download" && "info" in s.phase && s.phase.info) download(s.phase.info);
    else if (a === "restart") askRestart();
    else if (a === "retryCheck") check();
    else if (a === "compat") compat();
    else if (a === "retryDownload" && s.phase.kind === "error" && s.phase.info) download(s.phase.info);
  };

  const p = s.phase;
  const version = "info" in p && p.info ? p.info.version : null;
  const title =
    p.kind === "checking"
      ? "Checking for updates…"
      : p.kind === "upToDate"
        ? `Kolux RS is up to date`
        : p.kind === "available"
          ? `Kolux RS ${version} is available`
          : p.kind === "downloading"
            ? `Downloading Kolux RS ${version}`
            : p.kind === "ready"
              ? `Kolux RS ${version} is ready`
              : p.kind === "error"
                ? p.security
                  ? "Update refused for security"
                  : p.calm
                  ? "No update to install yet"
                  : p.retry === "restart"
                  ? `Kolux RS ${version} could not install`
                  : p.retry === "check" || p.retry === "compat"
                  ? "The update check failed"
                  : `Kolux RS ${version} did not download`
                : "";
  const pct = p.kind === "downloading" && p.total ? Math.min(100, Math.round((p.received / p.total) * 100)) : null;
  const action = mainAction(p);
  const label = restartingLabel(actionLabel(p), restarting);

  return (
    <>
      {s.shown && p.kind !== "idle" && (
        <div className="upd-wrap upd-fixed" aria-live="polite">
          {tipVisible(s) && (
            <div className="upd-tip" role="note">
              {RESTART_TIP}
              <button className="ib" title="Got it" onClick={() => dispatch({ type: "tipDismiss" })}>
                <Close size={11} />
              </button>
            </div>
          )}
          <div
            ref={cardEl}
            className={`upd-card ${s.collapsed ? "collapsed" : ""} ${p.kind}`}
            role="dialog"
            aria-label="Updates"
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                dispatch({ type: "collapse" });
              } else if (e.key === "Enter" && e.target === e.currentTarget) {
                e.preventDefault();
                // T-600: Restart ends every agent, so a bare Enter runs it only on a card the user opened.
                if (action !== "restart" || s.requested) act();
              }
            }}
          >
            <div className="upd-head" onClick={() => s.collapsed && expand()}>
              <span className="upd-icon">
                {p.kind === "checking" || p.kind === "downloading" ? <Spinner size={13} /> : p.kind === "upToDate" || p.kind === "ready" ? <CheckCircle size={13} /> : <Refresh size={13} />}
              </span>
              <span className="upd-title">{title}</span>
              {pct !== null && <span className="upd-pct">{pct}%</span>}
              <button className="ib" title={s.collapsed ? "Expand" : "Collapse (Esc)"} onClick={(e) => (e.stopPropagation(), s.collapsed ? expand() : dispatch({ type: "collapse" }))}>
                {s.collapsed ? "▴" : "▾"}
              </button>
              <button className="ib" title="Dismiss" onClick={(e) => (e.stopPropagation(), dispatch({ type: "dismiss" }))}>
                <Close size={11} />
              </button>
            </div>
            {!s.collapsed && (
              <div className="upd-body">
                {p.kind === "error" && (
                  <>
                    <div className="upd-err">{p.message}</div>
                    <div className="upd-next">{p.next}</div>
                  </>
                )}
                {p.kind === "downloading" && (
                  <div className="upd-bar" role="progressbar" aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
                    <div style={{ width: `${pct ?? 0}%` }} />
                  </div>
                )}
                {s.notes.length > 0 && p.kind !== "checking" && p.kind !== "upToDate" && (
                  <ul className="upd-notes">
                    {s.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                )}
                {p.kind === "ready" && <div className="upd-next">It also installs by itself the next time you quit.</div>}
                {label && (
                  <div className="upd-actions">
                    <button className={`btn ${action === "restart" || action === "download" ? "primary" : ""}`} disabled={restarting} onClick={act}>
                      {label}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {s.popup && !(s.shown && version === s.popup) && (
        // The ONE notice (APP-025): the update has downloaded by itself and waits for the user.
        // Update now is the restart-to-update action; Later closes it for this launch (it installs on quit).
        // Escape is Later when the keyboard is on it; a bare Enter on the container starts nothing.
        <div
          className="upd-pop upd-fixed"
          role="status"
          aria-label="Update available"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              dispatch({ type: "popupClose" });
            } else if (e.key === "Enter" && e.target === e.currentTarget) e.preventDefault();
          }}
        >
          <CheckCircle size={13} />
          <span className="upd-pop-text">
            A new Kolux RS version is out on GitHub. <span className="upd-pop-ver">Version {s.popup}.</span>
          </span>
          <span className="upd-pop-actions">
            <button type="button" className="btn" onClick={() => dispatch({ type: "popupClose" })}>
              Later
            </button>
            <button type="button" className="btn primary" disabled={restarting} onClick={askRestart}>
              {restarting ? "Restarting…" : "Update now"}
            </button>
          </span>
        </div>
      )}
      {confirming && <Ask title={RESTART_ASK.title} body={RESTART_ASK.body} confirm={RESTART_ASK.confirm} onConfirm={restart} onCancel={() => setConfirming(false)} />}
    </>
  );
}
