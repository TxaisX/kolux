// VIEW-106: the About panel. Opens on ABOUT_EVENT; asks the app for its version and whether this launch runs in safe graphics.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { probeGpu } from "../terminal/inputWire";
import type { AppInfo } from "../app-info";
import { ABOUT_EVENT, aboutRows, type AboutFacts } from "./about";

export default function AboutPanel() {
  const [open, setOpen] = useState(false);
  const [facts, setFacts] = useState<AboutFacts>({ version: "", safeGraphics: null, gpu: null });
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(ABOUT_EVENT, on);
    return () => window.removeEventListener(ABOUT_EVENT, on);
  }, []);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setFacts({ version: "", safeGraphics: null, gpu: probeGpu() });
    void invoke<AppInfo>("app_info").then((i) => live && setFacts((f) => ({ ...f, version: i.version })), () => {});
    void invoke<unknown>("graphics_launch_choice").then((v) => live && setFacts((f) => ({ ...f, safeGraphics: v !== null && v !== undefined })), () => {});
    return () => {
      live = false;
    };
  }, [open]);
  if (!open) return null;
  return (
    <>
      <div className="menu-backdrop" onMouseDown={() => setOpen(false)} />
      <div className="menu about-panel" role="dialog" aria-label="About Kolux" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
        <h2 className="conn-name">About Kolux</h2>
        <dl className="about-rows">
          {aboutRows(facts).map((r) => (
            <div key={r.label} className="about-row">
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
        <button className="btn" autoFocus onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
    </>
  );
}
