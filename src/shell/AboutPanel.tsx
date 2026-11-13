// VIEW-106: the About panel. Opens on ABOUT_EVENT; asks the app for its version and whether this launch runs in safe graphics.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { probeGpu } from "../terminal/inputWire";
import type { AppInfo } from "../app-info";
import { ABOUT_EVENT, aboutRows, type AboutFacts } from "./about";
import { Dialog } from "../ui/Dialog";

export default function AboutPanel() {
  const [open, setOpen] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
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
    <Dialog onClose={() => setOpen(false)} label="About Kolux" className="menu about-panel" backdrop="menu-backdrop" initialFocus={close}>
      <h2 className="conn-name">About Kolux</h2>
      <dl className="about-rows">
        {aboutRows(facts).map((r) => (
          <div key={r.label} className="about-row">
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
      <button ref={close} className="btn" onClick={() => setOpen(false)}>
        Close
      </button>
    </Dialog>
  );
}
