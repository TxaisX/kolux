// Settings > Terminal & sessions: NATIVE-TERMINAL.md, the experimental Windows Terminal engine.
// Off by default and Windows only. The switch saves `terminalNative`, which src/terminal/inputPrefs.ts
// reads and TerminalPane hands to the engine; panes opened before the change keep xterm. When the
// engine is missing the card says why, read from the same command the pane calls, so the switch is
// never on with nothing behind it.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Platform } from "../keys/actions";
import { INPUT_FIELDS, readInput } from "../terminal/inputPrefs";

type Save = (patch: Record<string, unknown>) => void;

/** Where the engine was found, or why it was not (the Rust side's own words). */
type Engine = { ok: boolean; text: string };

export default function NativeTerminalCard({ settings, platform, onSave }: { settings: Record<string, unknown>; platform: Platform; onSave: Save }) {
  const on = readInput(settings, platform).native;
  const [engine, setEngine] = useState<Engine | null>(null);
  useEffect(() => {
    if (platform !== "win32") return;
    let alive = true;
    invoke<string>("native_term_available").then(
      (where) => alive && setEngine({ ok: true, text: where }),
      (why) => alive && setEngine({ ok: false, text: String(why) }),
    );
    return () => {
      alive = false;
    };
  }, [platform]);
  if (platform !== "win32") return null;
  return (
    <section className="conn-card" data-section="native">
      <h2 className="conn-name">Terminal drawing engine</h2>
      <label className="conn-switch">
        <input type="checkbox" role="switch" checked={on} onChange={(e) => onSave({ [INPUT_FIELDS.native]: e.target.checked })} />
        Draw panes with the Windows Terminal engine (experimental)
      </label>
      <p className="conn-detail">Needs Microsoft.Terminal.Control.dll beside Kolux.exe. Takes effect for panes opened after the change.</p>
      {engine && !engine.ok && <p className="conn-detail">This computer does not have the engine, so panes keep drawing the usual way: {engine.text}</p>}
      {engine?.ok && on && <p className="conn-detail">Engine found at {engine.text}.</p>}
    </section>
  );
}
