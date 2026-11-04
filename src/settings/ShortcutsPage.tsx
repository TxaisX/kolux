// Settings > Shortcuts: where the shortcuts file lives and what it got wrong, then every command
// grouped by area with its keys, badges, a clash hint, the filters and the search (SET-008, SET-010),
// and on each row the recorder: click a chord to replace it, Add for another, x to remove one,
// Disable and Reset (SET-009). Every change is written to the file at once.
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { inTerminal, POLICIES, POLICY_FIELD, readPolicy } from "../keys/terminalPolicy";
import { useSettings } from "./useSettings";
import { useKeymap } from "../keys/KeymapContext";
import { useNativeChords } from "../chrome/useChrome";
import { editChords, recordKey, recording, removeChord } from "../keys/record";
import { createDoubleTap, recordDoubleTap } from "../keys/doubleTap";
import { layoutNotes } from "../keys/helpNotes";
import { Segmented } from "./GeneralPage";
import { ResetButton } from "./SafetyRules";
import { openShortcutsFileIn, shortcutsFileApps } from "./shortcutsFileOpen";
import { AREAS, FILTERS, MAX_QUERY, filterRows, shortcutRows, type Filter, type Row } from "./shortcutRows";

type Rec = { id: string; index: number };

export default function ShortcutsPage() {
  const keymap = useKeymap();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [rec, setRec] = useState<Rec | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const status = useSettings();
  const policy = readPolicy(status.settings);
  const native = useNativeChords();
  const rows = useMemo(() => shortcutRows(keymap, native), [keymap, native]);
  const shown = filterRows(rows, filter, query);
  const taps = useRef(createDoubleTap()); // SET-009: a modifier tapped twice is recorded as its own kind of shortcut

  // While recording, every key press belongs to the recorder: the window's shortcuts stand
  // aside (`recording.on`) and Esc ends recording instead of closing Settings.
  useEffect(() => {
    if (!rec) return;
    recording.on = true;
    taps.current.reset();
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const tapped = recordDoubleTap(taps.current, e, e.timeStamp);
      const got = tapped ? { chord: tapped } : recordKey(e, keymap.platform, rec.id);
      if (got === null) return;
      if ("refused" in got) return setNote(got.refused);
      setRec(null);
      setNote(null);
      const now = rows.find((r) => r.id === rec.id)?.chords ?? [];
      if ("chord" in got) void keymap.save(rec.id, editChords(now, rec.index, got.chord));
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      recording.on = false;
      window.removeEventListener("keydown", onKey, true);
    };
  }, [rec, keymap, rows]);

  const record = (id: string, index: number) => {
    setNote(null);
    setRec(rec?.id === id && rec.index === index ? null : { id, index });
  };
  const remove = (r: Row, i: number) => {
    const out = removeChord(r.chords, i, rec?.id === r.id ? rec : null);
    if (rec?.id === r.id) setRec(out.recording && { id: r.id, index: out.recording.index });
    void keymap.save(r.id, out.chords);
  };
  // SET-012: the file opens in the program the system gives it, or is picked out in its folder;
  // a missing file is written with its starting contents first.
  const show = (reveal: boolean) => {
    setFileNote(null);
    invoke("keybindings_show", { reveal }).catch((e) => setFileNote(String(e)));
  };
  const end = (then: () => void) => () => {
    setRec(null);
    then();
  };

  return (
    <>
      <section className="conn-card" data-section="shortcuts-file">
        <h2 className="conn-name">Shortcuts file</h2>
        <p className="conn-detail">{keymap.path ?? "Reading where the file is..."}</p>
        {keymap.errors.map((e, i) => (
          <p key={i} className="conn-detail warn">
            {e}
          </p>
        ))}
        {fileNote && <p className="conn-detail warn">{fileNote}</p>}
        <div className="btn-row">
          <button className="btn" onClick={() => show(false)}>
            Open file
          </button>
          <button className="btn" onClick={() => show(true)}>
            Show in folder
          </button>
          <select
            className="field"
            aria-label="Open file in"
            value=""
            onChange={(e) => {
              const app = shortcutsFileApps(status.settings).find((a) => a.label === e.target.value);
              if (app) openShortcutsFileIn(app).catch((err) => setFileNote(String(err)));
            }}
          >
            <option value="">Open file in...</option>
            {shortcutsFileApps(status.settings).map((a) => (
              <option key={a.label} value={a.label}>
                {a.label}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => void invoke("keybindings_reload").catch((e) => setFileNote(String(e)))}>
            Reload from disk
          </button>
        </div>
      </section>
      <section className="conn-card" data-section="layout-notes">
        <h2 className="conn-name">Keyboard layouts</h2>
        {layoutNotes(keymap.platform).map((n) => (
          <p key={n} className="conn-detail">
            {n}
          </p>
        ))}
      </section>
      <section className="conn-card" data-section="terminal-first">
        <h2 className="conn-name">Shortcuts in terminals</h2>
        <p className="conn-detail">
          {policy === "kolux" ? "App shortcuts keep working while you type in a terminal." : "Only the commands marked safe for terminals fire; every other key goes to the program in the terminal."}
        </p>
        <Segmented label="Who gets shortcuts first" options={POLICIES} value={policy} onPick={(v) => void status.save({ [POLICY_FIELD]: v })} />
        {status.error && <p className="conn-detail warn">{status.error}</p>}
      </section>
      <section className="conn-card" data-section="key-bindings">
        <h2 className="conn-name">Commands and keys</h2>
        <div className="keys-bar">
          <Segmented label="Show" options={FILTERS.map(([id, label]) => ({ id, label }))} value={filter} onPick={setFilter} />
          <input className="field" type="search" aria-label="Search shortcuts" placeholder="Search commands or keys" maxLength={MAX_QUERY} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {shown.length === 0 && <p className="conn-detail">No command matches.</p>}
        {Object.values(AREAS).map((area) => {
          const group = shown.filter((r) => r.area === area);
          if (group.length === 0) return null;
          return (
            <div key={area} className="keys-group">
              <h3 className="keys-area">{area}</h3>
              <table className="keys-table">
                <tbody>
                  {group.map((r) => {
                    const at = rec?.id === r.id ? rec.index : -1;
                    return (
                      <tr key={r.id} data-id={r.id} className={at >= 0 ? "recording" : undefined}>
                        <td>
                          {r.title}
                          {r.hint && <p className="keys-hint">{r.hint}</p>}
                          {r.warning && <p className="keys-hint" role="note">{r.warning}</p>}
                          {at >= 0 && <p className="keys-hint" role="alert">{note ?? "Press the new keys, or tap one modifier twice. Esc keeps what was there."}</p>}
                        </td>
                        <td>
                          {r.labels.map((l, i) => (
                            <span key={i} className="keys-slot">
                              <button className={`keys-chord${at === i ? " on" : ""}`} title="Click, then press the new keys" onClick={() => record(r.id, i)}>
                                {at === i ? "Press keys..." : l}
                              </button>
                              <ResetButton label="×" className="keys-x" title="Remove this shortcut" ariaLabel={`Remove ${l}`} yes="Yes, remove" onReset={() => remove(r, i)} />
                            </span>
                          ))}
                          {at === r.labels.length && <span className="keys-chord on">Press keys...</span>}
                          {r.labels.length === 0 && at < 0 && <span className="kbd-none">None</span>}
                        </td>
                        <td className="keys-badges">
                          {/* SET 008: what the command does while a terminal has focus. */}
                          {inTerminal(r.id, policy) === "held" && <span className="chip keys-badge held">Goes to the terminal</span>}
                          {r.badges.map((b) => (
                            <span key={b} className={`chip keys-badge ${b.toLowerCase()}`}>
                              {b}
                            </span>
                          ))}
                        </td>
                        <td className="keys-acts">
                          <button className="keys-act" aria-label={`Add a shortcut for ${r.title}`} onClick={() => record(r.id, r.chords.length)}>
                            Add
                          </button>
                          {r.chords.length > 0 && (
                            <button className="keys-act" aria-label={`Disable ${r.title}`} onClick={end(() => void keymap.save(r.id, null))}>
                              Disable
                            </button>
                          )}
                          {r.custom && (
                            <button className="keys-act" aria-label={`Reset ${r.title}`} onClick={end(() => void keymap.save(r.id, r.defaults, true))}>
                              Reset
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </section>
    </>
  );
}
