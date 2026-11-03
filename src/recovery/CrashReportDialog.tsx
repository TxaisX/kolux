// T-183 (APP-039): the crash report. The newest pending record prompts once at startup (dismissed as
// soon as it shows); Help > Report Crash (REPORT_CRASH_EVENT) reopens the newest even after that.
// Copy Details and Attach recent diagnostic logs put scrubbed text on the clipboard; Open on GitHub
// opens the pre-filled issue in the browser. Kolux sends nothing itself.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { REPORT_CRASH_EVENT } from "../chrome/chromeItems";
import { useDialogFocus } from "../chrome/dialogFocus";
import { dialogLead, issueUrl, openFromHelp, openPending, type Crash, type Dialog } from "./model";

async function copy(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export default function CrashReportDialog() {
  const [d, setD] = useState<Dialog>(null);
  const [details, setDetails] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    invoke<Crash | null>("crash_pending").then(
      (c) => {
        const next = openPending(c);
        setD(next);
        // shown once: the record is dismissed on show, so the next start asks nothing
        if (next) invoke("crash_dismiss", { id: next.crash.id }).catch(() => {});
      },
      () => {},
    );
    const fromHelp = () => {
      invoke<Crash | null>("crash_latest").then(
        (c) => {
          const next = openFromHelp(c);
          if (next) setD(next);
          else setNote("No crash has been recorded.");
        },
        (e) => setNote(`Could not read the crash records: ${String(e)}`),
      );
    };
    window.addEventListener(REPORT_CRASH_EVENT, fromHelp);
    return () => window.removeEventListener(REPORT_CRASH_EVENT, fromHelp);
  }, []);

  useEffect(() => {
    if (!d) return;
    setDetails("");
    invoke<string>("crash_details", { id: d.crash.id }).then(setDetails, (e) => setDetails(`(details could not be read: ${String(e)})`));
  }, [d]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(""), 6000);
    return () => clearTimeout(t);
  }, [note]);

  const copyDetails = () => copy(details).then(() => setNote("Details copied."), () => setNote("The clipboard could not be written; select the text and copy it instead."));
  const attachLogs = () =>
    invoke<string>("diag_bundle").then(
      (b) => copy(b).then(() => setNote("Recent diagnostic logs copied (scrubbed). Paste them into the issue."), () => setNote("The clipboard could not be written; use Settings > Diagnostics to review the logs instead.")),
      (e) => setNote(`Could not gather the logs: ${String(e)}`),
    );
  const openIssue = () =>
    invoke("open_external", { url: issueUrl(d!.crash, details) }).then(
      () => setD(null),
      (e) => setNote(`Could not open the browser: ${String(e)}`),
    );

  const toast = note ? (
    <div role="status" className="conn-detail" style={{ position: "fixed", left: 16, bottom: 16, maxWidth: 360, padding: "10px 12px", zIndex: 50, background: "var(--pane-bg)", border: "1px solid var(--line-subtle)", borderRadius: 8, color: "var(--fg-row)" }}>
      {note}
    </div>
  ) : null;
  if (!d) return toast;
  return (
    <>
      <CrashPanel lead={dialogLead(d)} details={details} onClose={() => setD(null)} onAttach={attachLogs} onCopy={copyDetails} onOpen={openIssue} />
      {toast}
    </>
  );
}

/** The report itself. Not now has the focus when it opens, Tab stays inside, Escape closes it from anywhere and focus
 *  goes back where it was (the shared dialog focus); Copy Details waits for the details to load. */
export function CrashPanel({ lead, details, onClose, onAttach, onCopy, onOpen }: { lead: string; details: string; onClose: () => void; onAttach: () => void; onCopy: () => void; onOpen: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const notNow = useRef<HTMLButtonElement>(null);
  useDialogFocus(box, onClose, () => notNow.current);
  return (
      <div className="scrim" onMouseDown={() => onClose()}>
        <div
          ref={box}
          role="dialog"
          aria-modal="true"
          aria-label="Report a crash"
          onMouseDown={(e) => e.stopPropagation()}
          style={{ width: "min(640px, calc(100vw - 48px))", display: "flex", flexDirection: "column", gap: 10, padding: "16px 18px", background: "var(--pane-bg)", border: "1px solid var(--line-focus)", borderRadius: 12, color: "var(--fg-row)" }}
        >
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Report a crash</h2>
          <p className="conn-detail" style={{ margin: 0 }}>
            {lead}
          </p>
          <textarea readOnly value={details} rows={8} aria-label="Crash details" style={{ width: "100%", boxSizing: "border-box", fontFamily: "var(--mono, monospace)", fontSize: 12 }} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button className="btn" onClick={onAttach}>
              Attach recent diagnostic logs
            </button>
            <button className="btn" onClick={onCopy} disabled={!details}>
              Copy Details
            </button>
            <button ref={notNow} className="btn" onClick={() => onClose()}>
              Not now
            </button>
            <button className="btn" onClick={onOpen} disabled={!details}>
              Open on GitHub
            </button>
          </div>
        </div>
      </div>
  );
}
