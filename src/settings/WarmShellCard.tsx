// Settings > Terminal & sessions: the kept-warm shell switch, on every platform. Off by default, it saves
// `terminalWarmShell`, which src/terminal/inputPrefs.ts reads; its label says what it costs.
import type { Platform } from "../keys/actions";
import { INPUT_FIELDS, readInput } from "../terminal/inputPrefs";

type Save = (patch: Record<string, unknown>) => void;

export default function WarmShellCard({ settings, platform, onSave }: { settings: Record<string, unknown>; platform: Platform; onSave: Save }) {
  const prefs = readInput(settings, platform);
  return (
    <section className="conn-card" data-section="warm-shell">
      <h2 className="conn-name">Faster new terminals</h2>
      <label className="conn-switch">
        <input type="checkbox" role="switch" checked={prefs.warmShell} onChange={(e) => onSave({ [INPUT_FIELDS.warmShell]: e.target.checked })} />
        Keep a shell ready per folder: new terminals open in about 0.3 s, uses about 56 MB per open folder
      </label>
      <p className="conn-detail">Plain shell terminals only; agents and chosen shells start as usual. Closing a folder ends its ready shell.</p>
    </section>
  );
}
