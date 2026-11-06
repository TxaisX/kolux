// ONB-014, ONB-009, ONB-032 and APP-010: the help menu's sheet — Settings, then the Help group (Getting
// Started, Explore Kolux, Docs, Changelog, GitHub, Milestones with its ring, Keyboard Shortcuts, the
// wizard again, Send Feedback, Copy terminal diagnostics, Check for Updates, Restart Kolux) and every
// tour by name. The list itself is helpItems (plain data); this draws it and wires the real actions.
// It loads the first time the help button is clicked (lazy/pages), so the guide's live steps, its ring
// and the tour catalogue stay out of the window's first frame.
import { Fragment, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { REPORT_CRASH_EVENT } from "../chrome/chromeItems";
import { requestFeedback } from "../feedback/FeedbackDialog";
import { openSettings } from "../settings/pages";
import { requestUpdateCheck } from "../update/bus";
import { milestonesShown, openExplore, openGuide, ring } from "./guide";
import { Ring, useGuideState } from "./Guides";
import { replayTour, TOURS } from "./tour";
import { REOPEN_WIZARD } from "./firstRun";
import { copyDiagnostics, createRestart, helpItems, TOURS_HINT, type RestartState } from "./helpItems";

export default function HelpSheet({ at, onClose }: { at: { bottom: number; left: number }; onClose: () => void }) {
  const g = useGuideState(true);
  const r = ring(g.done);
  const [restart, setRestart] = useState<RestartState>("idle");
  const [note, setNote] = useState("");
  // One restart per sheet: the click handler is made once, so a second click finds it busy.
  const [restartOnce] = useState(() => createRestart(() => invoke("app_restart"), setRestart, (why) => setNote(why)));
  const restarting = restart === "restarting";
  const pick = (go: () => void) => {
    onClose();
    go();
  };
  const items = useMemo(
    () =>
      helpItems({
        milestones: { shown: milestonesShown(g.done), done: r.done, total: r.total },
        restarting,
        openSettings: (p) => openSettings(p),
        openExternal: (url) => void invoke("open_external", { url }).catch((e: unknown) => setNote(String(e))),
        openGuide: () => openGuide(),
        openExplore,
        reopenWizard: () => window.dispatchEvent(new CustomEvent(REOPEN_WIZARD)),
        requestFeedback: () => requestFeedback(),
        reportCrash: () => window.dispatchEvent(new Event(REPORT_CRASH_EVENT)),
        copyDiagnostics: () => {
          setNote("");
          void copyDiagnostics(
            () => invoke<string>("diag_summary"),
            (text) => invoke("clip_copy_text", { text }).catch(() => navigator.clipboard.writeText(text)),
          ).then(setNote);
        },
        checkForUpdates: requestUpdateCheck,
        restart: () => {
          setNote("");
          restartOnce();
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- g.done is what milestonesShown and ring read
    [g.done, restarting],
  );
  return (
    <>
      <div className="menu-backdrop" onClick={restarting ? undefined : onClose} aria-hidden="true" />
      <div className="menu" role="menu" aria-label="Help" style={at} onKeyDown={(e) => e.key === "Escape" && !restarting && onClose()}>
        {items.map((it, i) => (
          <Fragment key={it.id}>
            {it.group === "help" && items[i - 1]?.group === "top" && <div className="menu-title">Help</div>}
            <button role="menuitem" className="menu-item" disabled={it.disabled} aria-busy={it.id === "restart" && restarting ? true : undefined} onClick={() => (it.keepOpen ? it.run() : pick(it.run))} autoFocus={i === 0}>
              {it.ring && <Ring done={it.ring.done} total={it.ring.total} size={18} />}
              {it.label}
              {it.hint && <span className="menu-hint-inline">{it.hint}</span>}
              {it.ring && (
                <span className="menu-hint-inline">
                  {it.ring.done}/{it.ring.total}
                </span>
              )}
            </button>
          </Fragment>
        ))}
        {note && (
          <div className="menu-title" role="status" style={{ textTransform: "none", whiteSpace: "normal", maxWidth: 260 }}>
            {note}
          </div>
        )}
        {/* ONB-032: replay any tour, seen or not, whatever this launch already showed. */}
        <div className="menu-title">Tours</div>
        <div className="menu-hint">{TOURS_HINT}</div>
        {TOURS.filter((t) => t.id !== "grid").map((t) => (
          <button key={t.id} role="menuitem" className="menu-item" onClick={() => pick(() => replayTour(t.id))}>
            {t.name}
          </button>
        ))}
      </div>
    </>
  );
}
