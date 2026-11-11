import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { saveChanged } from "./saveChanged";
import { invoke } from "@tauri-apps/api/core";
import { applyBroadcast, createLoadRace, readBroadcast, adoptStored, withoutSecrets } from "./settingsSync";
import { windowSettings } from "./windowSettings";
import { sharedRead } from "./sharedRead";
import { tidySettings } from "./tidy";

/** Runs `fn` one call at a time, in call order; a failed call does not hold up the next. */
export function inTurn<A, R>(fn: (arg: A) => Promise<R>): (arg: A) => Promise<R> {
  let last: Promise<unknown> = Promise.resolve();
  return (arg) => {
    const run = last.catch(() => undefined).then(() => fn(arg));
    last = run;
    return run;
  };
}

/** True when two settings copies hold the same values (JSON-shaped: what `get_settings` returns), in any key order. */
export function sameSettings(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  return ka.length === Object.keys(b).length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameSettings(ra[k], rb[k]));
}

/** Every page's saves share one turn: each reads, merges and writes what is on disk, so two at
 * once (a field's blur, then a switch) would drop the first. Values are tidied on the way in
 * (SET-035), and what the window takes afterwards is what was really stored. */
const saveInTurn = inTurn((patch: Record<string, unknown>) =>
  invoke<Record<string, unknown>>("get_settings").then((s) => saveChanged(s, tidySettings({ ...s, ...patch }))).then(() => invoke<Record<string, unknown>>("get_settings")),
);

/** The saved settings for a Settings page, and `save(patch)`, which merges into what is on disk
 * and settles true once it is written, or false when it failed: the page then shows why and takes
 * back what is stored (T-598: a draft field keeps its typed text). The page follows saves made in
 * any window (SET-035). */
export function useSettings() {
  // The page draws at once from the copy the window already holds; its own read replaces that when it lands (a change
  // made meanwhile is laid over the read, createLoadRace), and every save merges into what is on disk, so a seed that
  // was a moment old never writes a field the page did not change.
  const [settings, setSettings] = useState<Record<string, unknown> | null>(() => {
    const w = windowSettings();
    return w && tidySettings(withoutSecrets(w));
  });
  const [error, setError] = useState<string | null>(null);
  const race = useRef(createLoadRace());
  // T-735: the last copy known to be on disk (load, broadcasts, read-backs), never an optimistic change.
  const disk = useRef<Record<string, unknown> | null>(null);
  // T-752 (DT-C188): a first read that failed can be asked again (the page's Try again).
  const reread = useRef(() => {});
  useEffect(() => {
    let gone = false;
    // PKG-4: the mount read shares a get_settings already in flight (the window's own start read, other mounts);
    // saveInTurn above keeps real reads, since it reads, merges, writes and reads back.
    const read = () =>
      sharedRead().then(
        (s) => {
          if (gone) return;
          disk.current = s;
          setError(null);
          // The read usually finds what the seed already drew: keeping the same object lets React skip redrawing the
          // whole page a few milliseconds after it was drawn (on every visit to a page, the cost of a second draw).
          const next = race.current.loaded(s);
          setSettings((cur) => (cur !== null && sameSettings(cur, next) ? cur : next));
        },
        (e) => !gone && setError(String(e)),
      );
    reread.current = () => (setError(null), void read());
    void read();
    const off = listen("settings-saved", (e) => {
      const b = readBroadcast(e.payload);
      if (b && disk.current) disk.current = applyBroadcast(disk.current, b);
      if (b) setSettings((s) => s && applyBroadcast(s, b));
      else void read();
    }).catch(() => () => {}); // no event bridge (a plain page): the page still works, it just misses other windows
    return () => {
      gone = true;
      void off.then((f) => f());
    };
  }, []);
  const save = (patch: Record<string, unknown>): Promise<boolean> => {
    setError(null);
    race.current.change(patch);
    setSettings((s) => s && { ...s, ...patch });
    return saveInTurn(patch)
      .then((stored) => ((disk.current = stored), setSettings((s) => s && adoptStored(s, stored, patch)), true))
      .catch((e) => {
        setError(String(e));
        // A failed save puts back only its own keys; what other saves stored stays. T-735: when the stored copy
        // cannot be read either, its keys go back to the last copy known to be on disk, not to an earlier
        // save's change still waiting its turn.
        const back = (stored: Record<string, unknown>) => setSettings((s) => s && adoptStored(s, stored, patch));
        return invoke<Record<string, unknown>>("get_settings")
          .then(
            (s) => back((disk.current = s)),
            () => disk.current && back(disk.current),
          )
          .then(() => false);
      });
  };
  return { settings, error, save, retry: () => reread.current() };
}
