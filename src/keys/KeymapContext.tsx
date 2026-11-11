// The keymap the window runs on. The provider reads `~/.kolux/keybindings.json` through the
// Rust side once at start (reload is explicit, COMPAT.md 4.1: no file watcher), resolves it with
// the built-in defaults and hands the map to every component that shows or presses a shortcut.
// Without a provider (tests, server rendering) the context holds this platform's defaults.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { disabledAgents } from "../launch/agents";
import { onlyWindowState } from "../settings/settingsSync";
import { defaultsOnly, detectPlatform, labelOf, resolve, type Keymap } from "./keymap";
import { SEEDED_FIELD, seedFirstLoad } from "./tabKeysSeed";

export type KeybindingsFile = { path: string; value: unknown; created: boolean; error: string | null };

export type KeymapState = Keymap & {
  /** Where the file lives, once the Rust side has said. */
  path: string | null;
  /** Reads the file again. */
  reload: () => void;
  /** SET-009: writes one command's chords into this platform's section (null: disabled), or with
   *  `reset` puts the shipped default back. Every window reads the file again afterwards. */
  save: (id: string, chords: string[] | null, reset?: boolean) => Promise<void>;
};

const platform = detectPlatform();
const fallback: KeymapState = { ...defaultsOnly(platform), path: null, reload: () => {}, save: async () => {} };

export const KeymapContext = createContext<KeymapState>(fallback);

export function KeymapProvider({ children }: { children: ReactNode }) {
  const [file, setFile] = useState<KeybindingsFile | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const reload = useCallback(() => {
    invoke<KeybindingsFile>("keybindings_read")
      .then((f) => {
        setFile(f);
        setFailure(null);
      })
      .catch((e) => setFailure(String(e)));
  }, []);
  useEffect(reload, [reload]);
  // SET-009: a change saved in any window reaches every window.
  useEffect(() => {
    const off = listen("keybindings-changed", reload);
    return () => void off.then((u) => u()).catch(() => {});
  }, [reload]);
  const save = useCallback(async (id: string, chords: string[] | null, reset = false) => {
    const value = chords === null || chords.length === 0 ? null : chords.length === 1 ? chords[0] : chords;
    try {
      setFile(await invoke<KeybindingsFile>("keybindings_write", { id, value, reset }));
      setFailure(null);
    } catch (e) {
      setFailure(String(e));
    }
  }, []);
  // SET-015: the first read of an install that already had a file keeps its old tab-stepping pairing, once.
  const seeding = useRef(false);
  useEffect(() => {
    if (!file || seeding.current) return;
    seeding.current = true;
    void seedFirstLoad(file, {
      settings: () => invoke<Record<string, unknown>>("get_settings"),
      mark: () => invoke("settings_patch", { set: { [SEEDED_FIELD]: true }, remove: [] }),
      write: (id, chords) => save(id, chords),
    }).catch(() => {
      seeding.current = false; // tried again at the next read
    });
  }, [file, save]);
  // SET-010: the new-tab commands of agents switched off on the Agents page never clash.
  const [ignore, setIgnore] = useState<string[]>([]);
  useEffect(() => {
    const read = () => void invoke<Record<string, unknown>>("get_settings").then((s) => setIgnore(disabledAgents(s).map((id) => `tab.newAgent.${id}`))).catch(() => {});
    read();
    const off = listen("settings-saved", (e) => onlyWindowState(e?.payload) || read()); // a layout or screen save switches no agent off
    return () => void off.then((u) => u()).catch(() => {});
  }, []);
  const value = useMemo<KeymapState>(() => {
    const map = resolve(file?.value ?? null, platform, ignore);
    const errors = [...(file?.error ? [file.error] : []), ...(failure ? [`The shortcuts file: ${failure}`] : []), ...map.errors];
    return { ...map, errors, path: file?.path ?? null, reload, save };
  }, [file, failure, reload, ignore, save]);
  return <KeymapContext.Provider value={value}>{children}</KeymapContext.Provider>;
}

export const useKeymap = () => useContext(KeymapContext);

/** The parts of an action's first chord as the user reads them, [] when unassigned. */
export function useLabel(id: string): string[] {
  return labelOf(useKeymap(), id);
}

/** A chord drawn as keycaps with "+" between them, or "Unassigned". `shown`: the parts to draw instead of the
 *  command's first chord (T-800: the top-bar box shows the Ctrl+K that also opens it). */
export function Kbd({ id, shown }: { id: string; shown?: string[] }) {
  const first = useLabel(id);
  const parts = shown && shown.length > 0 ? shown : first;
  if (parts.length === 0) return <span className="kbd-none">Unassigned</span>;
  return (
    <>
      {parts.map((p, i) => (
        <span key={i} className="kbd-part">
          {i > 0 && <span className="kbd-plus">+</span>}
          <span className="kbd">{p}</span>
        </span>
      ))}
    </>
  );
}

/** A chord as plain text, "Ctrl+J", or "Unassigned". */
export function KeyText({ id }: { id: string }) {
  const parts = useLabel(id);
  return <>{parts.length ? parts.join("+") : "Unassigned"}</>;
}
