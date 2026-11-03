// SKILL-024: the page-level note that some Kolux skills installed outside Kolux are out of date (the one-time notice is SkillUpdateNotice, mounted by the window).
// SKILL-026: the background update dialog: what qualifies, why the rest is kept (with a reinstall
// command), Update, Stop, the per-skill result, and Show log with the installer's output.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import SkillInstall from "./SkillInstall";
import { INSTALL_DETAIL, skillBar, SKILLS_SHOW_EVENT } from "./skillBarStore";
import { MORE_ACTIONS, PAGE_HEADING, focusStranded, returnFocus, stillHeld } from "./menuFocus";
import { dialogStep, showStep, stopRun } from "./skills";
import type { Load } from "./skillBar";
import { STOP_LABEL, UPDATE_LABEL, UPDATING_LABEL, chipTone, noticeText, sumUpRun, updatable, type Checked } from "./updateNotice";

type Props = { workspace: string | null; onChanged?: () => void; /** The Kolux skills the Install panel offers. */ bundled?: string[]; /** SKILL-025: what the last check found, for the freshness pills. */ onFreshness?: (load: Load, checked: Checked | null) => void };

export default function SkillUpdate({ workspace, onChanged, bundled = [], onFreshness }: Props) {
  const [checked, setChecked] = useState<Checked | null>(null);
  const [open, setOpen] = useState(false);
  // SKILL-027: the run itself lives in the store, so it goes on (and the status bar shows it) with the dialog closed.
  const view = useSyncExternalStore(skillBar.subscribe, skillBar.get);
  const status = view.status;
  const [log, setLog] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const lastState = useRef<string | undefined>(undefined);
  // The dialog takes the keyboard when it opens and gives it back when it closes. An open that came from
  // "Install / reinstall Kolux skills" (the event's detail) lands on the Install panel instead of Close.
  const box = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const wantsInstall = useRef(false);
  const reviewBtn = useRef<HTMLButtonElement>(null);
  // Who had the keyboard when the dialog was asked for, noted before it opens (the Review button is gone by the time the dialog's
  // effect runs). `fromReview`: that was the Review button, which comes back as a new element when the dialog closes.
  const opener = useRef<HTMLElement | null>(null);
  const fromReview = useRef(false);
  const isOpen = useRef(false);
  isOpen.current = open;
  const remember = (el: Element | null, review = false) => {
    opener.current = el && el !== document.body ? (el as HTMLElement) : null;
    fromReview.current = review;
  };
  const installPanel = () => box.current?.querySelector<HTMLElement>(".skills-install input, .skills-install button") ?? null;

  const check = () => {
    onFreshness?.("checking", null);
    return invoke<Checked>("skills_update_check", { workspace }).then(
      (c) => (setChecked(c), onFreshness?.("ready", c)),
      () => (setChecked(null), onFreshness?.("failed", null)),
    );
  };
  useEffect(() => void check(), [workspace]);
  useEffect(() => {
    skillBar.sync();
    if (skillBar.takeWanted()) (remember(document.activeElement), setOpen(true));
    const show = (e: Event) => {
      const step = showStep(isOpen.current, (e as CustomEvent).detail === INSTALL_DETAIL);
      skillBar.takeWanted();
      if (step.focusInstall) {
        const panel = installPanel();
        panel?.focus();
        panel?.scrollIntoView?.({ block: "nearest" });
      }
      if (!step.open) return;
      wantsInstall.current = step.wantsInstall;
      remember(document.activeElement);
      setOpen(true);
    };
    window.addEventListener(SKILLS_SHOW_EVENT, show);
    return () => window.removeEventListener(SKILLS_SHOW_EVENT, show);
  }, []);
  useEffect(() => skillBar.reading(open), [open]);
  useEffect(() => {
    if (!open) return;
    const back = opener.current ?? (document.activeElement === document.body ? null : (document.activeElement as HTMLElement | null));
    const review = fromReview.current;
    opener.current = null;
    fromReview.current = false;
    const panel = wantsInstall.current ? installPanel() : null;
    wantsInstall.current = false;
    (panel ?? closeBtn.current)?.focus();
    panel?.scrollIntoView?.({ block: "nearest" });
    // On close: the opener, else the Review button's replacement, else this page's More actions button or heading
    // (never the palette's terminal fallbacks: a terminal can sit hidden behind this page).
    return () => void returnFocus(back, [() => (review ? reviewBtn.current : null), () => document.querySelector<HTMLElement>(MORE_ACTIONS), () => document.querySelector<HTMLElement>(PAGE_HEADING)]);
  }, [open]);
  // Whether focus was last inside the dialog: an overlay opened over it that takes focus is never robbed by the refocus below.
  const held = useRef(false);
  // The Stop button leaves (or the button just pressed turns off) and focus falls to nothing: Escape and Tab would then reach the
  // page behind, so the dialog takes the keyboard back.
  useEffect(() => {
    if (open && held.current && focusStranded(document.activeElement, document.body)) box.current?.focus();
  });
  useEffect(() => () => skillBar.reading(false), []);
  // A finished run: look again, and let the page reload its list.
  useEffect(() => {
    if (status?.state === "done" && lastState.current !== "done") {
      check();
      onChanged?.();
    }
    lastState.current = status?.state;
  }, [status?.state]);

  const busy = status?.state === "running" || status?.state === "stopping";
  const start = () => {
    if (!checked) return;
    setErr(null);
    setLog(false);
    const names = updatable(checked.report);
    invoke("skills_update_clear")
      .then(() => invoke("skills_update_start", { workspace, names }))
      .then(() => skillBar.begin(names))
      .catch((e) => setErr(String(e)));
  };
  // The dialog may be closed while the update runs: the status bar item carries it from here.
  const close = () => {
    setOpen(false);
    if (status?.state === "done") invoke("skills_update_clear").catch(() => undefined);
  };

  const rows = checked?.report.rows ?? [];
  return (
    <>
      {!open && (checked?.report.available ?? 0) > 0 && (
        <div className="skills-note" role="status">
          {noticeText(checked?.report.available ?? 0)}{" "}
          <button
            ref={reviewBtn}
            className="btn"
            onClick={(e) => {
              remember(e.currentTarget, true);
              setOpen(true);
            }}
          >
            Review
          </button>
        </div>
      )}
      {open && (
        <div className="ask-backdrop" onMouseDown={close}>
          <div
            ref={box}
            className="ask"
            role="dialog"
            aria-modal="true"
            aria-label="Update Kolux skills"
            tabIndex={-1}
            style={{ outline: "none" }}
            onMouseDown={(e) => e.stopPropagation()}
            onFocus={() => void (held.current = true)}
            onBlur={(e) => void (held.current = stillHeld(e.relatedTarget, e.currentTarget))}
            onKeyDown={(e) => {
              const all = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"));
              const step = dialogStep(e.key, e.shiftKey, all.length, all.indexOf(document.activeElement as HTMLElement));
              if (step.act === "pass") return;
              e.preventDefault();
              // Escape closes this dialog only: the Skills page behind it must not hear it.
              if (step.act === "close") (e.stopPropagation(), close());
              else all[step.to].focus();
            }}
          >
            <h2 className="ask-title">Update Kolux skills</h2>
            <div className="ask-body">
              <p>These skills were installed with the community skills installer. Only copies it recorded and you have not changed are updated.</p>
              <ul>
                {rows.map((r) => (
                  <li key={r.name}>
                    <strong>{r.name}</strong> {r.state === "available" ? "can be updated" : r.state === "current" ? "is up to date" : "was kept"}
                    {r.copies.flatMap((c) => c.chips).map((c, i) => (
                      <span key={i} className={`chip chip-${chipTone(c)}`}>
                        {c}
                      </span>
                    ))}
                    {r.reason && <div className="skills-note">{r.reason}</div>}
                    {r.reinstall && (
                      <div className="skills-note">
                        To reinstall it: <code>{r.reinstall}</code>
                      </div>
                    )}
                    {status?.results.filter((x) => x.name === r.name).map((x) => (
                      <div key={x.name} role="status">
                        {x.ok ? "Updated" : `Not updated${x.reason ? `: ${x.reason}` : ""}`}
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
              {err && <p className="skills-err">{err}</p>}
              {status?.state === "done" && <p role="status">{sumUpRun(status)}</p>}
              {bundled.length > 0 && <SkillInstall names={bundled} />}
              {status && status.state !== "running" && status.log && (
                <>
                  <button className="btn" onClick={() => setLog(!log)}>
                    {log ? "Hide log" : "Show log"}
                  </button>
                  {log && <pre className="skills-log">{status.log}</pre>}
                </>
              )}
            </div>
            <div className="btn-row">
              <button ref={closeBtn} className="btn" onClick={close}>
                Close
              </button>
              {busy ? (
                <button className="btn danger" onClick={() => void stopRun(invoke).then((why) => why && setErr(why))} disabled={status?.state === "stopping"}>
                  {STOP_LABEL}
                </button>
              ) : null}
              <button className="btn primary" onClick={start} disabled={busy || (checked?.report.available ?? 0) === 0}>
                {busy ? UPDATING_LABEL : UPDATE_LABEL}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
