// T-183: the page's side of recovery, mounted once in App.tsx (evidence/reliability-T-183-App.tsx.patch).
// APP-042: a heartbeat every two seconds to the watch in recovery.rs; an error page or a frozen
// script sends none, so the watch reloads it. APP-043: every lost graphics context is reported;
// when the burst fires the flag is already saved and the page offers Restart in safe graphics or
// Keep Running; a launch that is already in safe graphics asks whether to stay (stay preselected).
// APP-039: the crash report dialog. T-199 (APP-028): an update that did not install is reported at
// the next launch with Try again and the installer page.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import CrashReportDialog from "./CrashReportDialog";
import RecoveryNotes from "./RecoveryNotes";
import { loadRecoveryNotes } from "./startupNotes";
import { repaint, WOKE_EVENT } from "./hidden";
import { requestUpdateCheck } from "../update/UpdateCenter";
import { useHeartbeat } from "./heartbeat";
import { afterBurst, launchPrompt, updateNotice, type GraphicsPrompt, type LastAttempt } from "./model";

export default function RecoveryMount() {
  const [g, setG] = useState<GraphicsPrompt>(null);
  const [upd, setUpd] = useState<ReturnType<typeof updateNotice>>(null);
  const [gerr, setGerr] = useState(""); // a graphics choice that did not go through, told in one line
  const [recovered, setRecovered] = useState<string[]>([]); // row 789: startup repairs, told once

  useEffect(() => {
    void loadRecoveryNotes(() => invoke<string[]>("startup_recovery_notes")).then(setRecovered);
    invoke<LastAttempt>("update_last_attempt").then((a) => setUpd(updateNotice(a)), () => {});
  }, []);

  useHeartbeat();
  useEffect(() => setGerr(""), [g]); // an old failure line does not outlive the prompt it was about

  // T-286-b (APP-017): after the computer wakes the page replays held updates and repaints.
  useEffect(() => {
    const off = listen(WOKE_EVENT, () => repaint());
    return () => void off.then((u) => u()).catch(() => {});
  }, []);

  useEffect(() => {
    invoke<{ version: string; chosen: boolean } | null>("graphics_launch_choice").then((f) => setG((cur) => cur ?? launchPrompt(f)), () => {});
    const lost = () => {
      invoke<boolean>("graphics_crash_noted").then((fired) => setG((cur) => afterBurst(cur, fired)), () => {});
    };
    window.addEventListener("webglcontextlost", lost, true);
    return () => window.removeEventListener("webglcontextlost", lost, true);
  }, []);

  const updNotice = upd && (
    <div className="notice" role="alert" aria-label="Update" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span>{upd.text}</span>
      <button className="btn" onClick={() => (setUpd(null), requestUpdateCheck())}>
        Try again
      </button>
      <a className="btn" href={upd.releasesPage} target="_blank" rel="noreferrer">
        Download installer
      </a>
      <button className="btn" onClick={() => setUpd(null)}>
        Dismiss
      </button>
    </div>
  );
  if (!g) return (
    <>
      <CrashReportDialog />
      <RecoveryNotes notes={recovered} onDismiss={() => setRecovered([])} />
      {updNotice}
    </>
  );
  const stay = g.kind === "launch" && g.stay;
  // T-724 (DT-C160): a choice closes the prompt only once it went through; a failure stays in the prompt, told.
  // Restart and Try hardware again restart the app when they work, so they never close it themselves.
  const choose = (cmd: string, fail: string, close?: boolean, args?: Record<string, boolean>) =>
    (setGerr(""), void invoke(cmd, args).then(() => close && setG(null), (e) => setGerr(`${fail}: ${String(e)}`)));
  return (
    <>
      <CrashReportDialog />
      <RecoveryNotes notes={recovered} onDismiss={() => setRecovered([])} />
      {updNotice}
      <div className="notice" role="alertdialog" aria-label="Graphics" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {g.kind === "burst" ? (
          <>
            <span>Kolux's graphics crashed several times in a minute. Safe graphics (no hardware acceleration) usually stops that; your terminals keep running.</span>
            <button className="btn" autoFocus onClick={() => choose("graphics_restart_safe", "Could not restart in safe graphics")}>
              Restart in safe graphics
            </button>
            <button className="btn" onClick={() => choose("graphics_keep_running", "Could not save Keep Running", true)}>
              Keep Running
            </button>
          </>
        ) : (
          <>
            <span>Kolux is running in safe graphics after repeated graphics crashes. Stay in safe graphics?</span>
            <button className="btn" autoFocus={stay} onClick={() => choose("graphics_choose", "Could not save Stay in safe graphics", true, { stay: true })}>
              Stay in safe graphics
            </button>
            <button className="btn" autoFocus={!stay} onClick={() => choose("graphics_choose", "Could not switch back to hardware graphics", false, { stay: false })}>
              Try hardware again
            </button>
          </>
        )}
        {gerr && <span role="status">{gerr}</span>}
      </div>
    </>
  );
}
