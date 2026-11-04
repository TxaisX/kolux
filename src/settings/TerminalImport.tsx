// TERM-099 / TERM-100 (T-307): Settings > Terminal > "Bring in from Ghostty or Warp". Looks in the
// two apps' own folders, shows what it found and what it cannot use, and saves only when asked.
import { useState } from "react";
import { applyAppearance, readAppearance } from "../theme";
import { bringIn, planImport, planSummary, type GhosttyImport, type WarpScan } from "./importSchemes";
import { ghosttyPatch, pickedSchemes, previewLines, readGhostty, readSavedSettings, readWarp, saveChecked, warpRows } from "./terminalImportRead";

type Props = { settings: Record<string, unknown>; save: (patch: Record<string, unknown>) => Promise<unknown> };

/** Saves a patch and shows it on the open window now (colours, fonts and dividers). */
const applyNow = (settings: Record<string, unknown>, patch: Record<string, unknown>) => applyAppearance(readAppearance({ ...settings, ...patch }));

export function GhosttyImportBox({ settings, save }: Props) {
  const [found, setFound] = useState<GhosttyImport | null | "none">(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const look = async () => {
    setBusy(true);
    setResult("");
    try {
      setFound((await readGhostty()) ?? "none");
    } catch {
      setFound(null);
      setResult("Could not look for a Ghostty configuration.");
    } finally {
      setBusy(false);
    }
  };
  const apply = async (r: GhosttyImport) => {
    const { patch, plan } = ghosttyPatch(readAppearance(settings).custom, r);
    setBusy(true);
    const saved = Object.keys(patch).length === 0 || (await saveChecked(save, patch, readSavedSettings));
    setBusy(false);
    if (!saved) {
      // Nothing is shown as changed: the window keeps its look, and the import stays open to try again.
      setResult("The import could not be saved, so nothing was changed. Try again.");
      return;
    }
    applyNow(settings, patch);
    const done = [r.applied.length && `Set ${r.applied.join(", ")}.`, (plan.added.length || plan.replaced.length || plan.refused.length) && planSummary(plan)].filter(Boolean).join(" ");
    setResult(done || "Nothing changed.");
    setFound(null);
  };
  const r = found && found !== "none" ? found : null;
  // The preview and Bring in use the same plan, so the preview never promises what the cap will refuse.
  const now = r ? ghosttyPatch(readAppearance(settings).custom, r) : null;
  return (
    <div className="scheme-import" data-section="ghostty-import">
      <div className="btn-row">
        <button type="button" className="btn" disabled={busy} onClick={() => void look()}>
          {busy ? "Looking…" : "Look for my Ghostty settings"}
        </button>
      </div>
      <p className="conn-detail">Reads your Ghostty configuration and the theme it names. Nothing changes until you bring it in.</p>
      {found === "none" && <p className="conn-detail">No Ghostty configuration was found on this computer.</p>}
      {r && (
        <div role="group" aria-label="Ghostty settings to bring in">
          {r.applied.length > 0 && <p className="conn-detail">Will set: {r.applied.join(", ")}.</p>}
          {now &&
            previewLines(now.plan).map((l) => (
              <p key={l} className="conn-detail">{l}</p>
            ))}
          {r.notes.map((n) => (
            <p key={n} className="conn-detail">{n}</p>
          ))}
          {r.unsupported.length > 0 && <p className="conn-detail">Left out, because Kolux has no such setting yet: {r.unsupported.join(", ")}.</p>}
          {r.invalid.map((i, k) => (
            <p key={k} className="conn-detail warn">
              Left out: {i.key}{i.value ? ` = ${i.value}` : ""} ({i.reason}).
            </p>
          ))}
          {r.skipped.map((s, i) => (
            <p key={`${i}:${s.file}`} className="conn-detail warn">
              {s.file} {s.reason}.
            </p>
          ))}
          {now && Object.keys(now.patch).length === 0 && <p className="conn-detail">There is nothing in it to bring in.</p>}
          <div className="btn-row">
            <button type="button" className="btn" disabled={busy || !now || Object.keys(now.patch).length === 0} onClick={() => void apply(r)}>
              Bring in
            </button>
            <button type="button" className="btn" onClick={() => setFound(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {result && <p className="conn-detail">{result}</p>}
    </div>
  );
}

export function WarpImportBox({ settings, save }: Props) {
  const [scan, setScan] = useState<WarpScan | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set()); // row keys (place + file name), not bare file names
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const look = async () => {
    setBusy(true);
    setResult("");
    try {
      setScan(await readWarp());
      setTicked(new Set());
    } catch {
      setScan(null);
      setResult("Could not look for Warp themes.");
    } finally {
      setBusy(false);
    }
  };
  const apply = async (s: WarpScan) => {
    const plan = planImport(readAppearance(settings).custom, pickedSchemes(warpRows(s), ticked));
    if (plan.added.length || plan.replaced.length) {
      const patch = { terminalCustomSchemes: plan.custom };
      setBusy(true);
      const saved = await saveChecked(save, patch, readSavedSettings);
      setBusy(false);
      if (!saved) {
        setResult("The themes could not be saved, so nothing was changed. Try again.");
        return;
      }
      applyNow(settings, patch);
    }
    setResult(planSummary(plan));
    setScan(null);
  };
  const rows = scan ? warpRows(scan) : [];
  return (
    <div className="scheme-import" data-section="warp-import">
      <div className="btn-row">
        <button type="button" className="btn" disabled={busy} onClick={() => void look()}>
          {busy ? "Looking…" : "Look for my Warp themes"}
        </button>
      </div>
      <p className="conn-detail">Reads the theme files in Warp's theme folders. Pick the ones to add to your custom colour schemes.</p>
      {scan && scan.themes.length === 0 && scan.skipped.length === 0 && <p className="conn-detail">No Warp themes were found on this computer.</p>}
      {scan && (scan.themes.length > 0 || scan.skipped.length > 0) && (
        <div role="group" aria-label="Warp themes to bring in">
          {scan.themes.length > 1 && (
            <label className="conn-switch">
              <input type="checkbox" aria-label="Select all" checked={ticked.size === rows.length} onChange={(e) => setTicked(e.target.checked ? new Set(rows.map((t) => t.key)) : new Set())} />
              <span>Select all</span>
            </label>
          )}
          {rows.map((t) => (
            <label key={t.key} className="conn-switch scheme-incoming">
              <input
                type="checkbox"
                aria-label={`Bring in ${t.scheme.name}`}
                checked={ticked.has(t.key)}
                onChange={(e) => setTicked((c) => (e.target.checked ? new Set(c).add(t.key) : new Set([...c].filter((k) => k !== t.key))))}
              />
              <span className="scheme-swatch" style={{ background: t.scheme.background, color: t.scheme.foreground }}>
                Aa
                {(["red", "green", "yellow", "blue"] as const).map((k) => (
                  <i key={k} style={{ background: t.scheme[k] }} />
                ))}
              </span>
              <span>
                {t.scheme.name}
                <small>{t.left.length > 0 ? `Skipped: ${t.left.join(", ")}.` : t.file}</small>
              </span>
            </label>
          ))}
          {scan.skipped.map((s, i) => (
            <p key={`${i}:${s.file}`} className="conn-detail warn">
              {s.file}: {s.reason}
            </p>
          ))}
          <div className="btn-row">
            <button type="button" className="btn" disabled={busy || ticked.size === 0} onClick={() => void apply(scan)}>
              {bringIn(ticked.size)}
            </button>
            <button type="button" className="btn" onClick={() => setScan(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {result && <p className="conn-detail">{result}</p>}
    </div>
  );
}

export default function TerminalImport(props: Props) {
  return (
    <section className="conn-card" data-section="terminal-import">
      <h2 className="conn-name">Bring in from Ghostty or Warp</h2>
      <GhosttyImportBox {...props} />
      <WarpImportBox {...props} />
    </section>
  );
}
