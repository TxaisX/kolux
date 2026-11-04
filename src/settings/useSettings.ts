import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { saveChanged } from "./saveChanged";
import { invoke } from "@tauri-apps/api/core";
import { applyBroadcast, createLoadRace, readBroadcast, adoptStored } from "./settingsSync";
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
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const race = useRef(createLoadRace());
  // T-735: the last copy known to be on disk (load, broadcasts, read-backs), never an optimistic change.
  const disk = useRef<Record<string, unknown> | null>(null);
  // T-752 (DT-C188): a first read that failed can be asked again (the page's Try again).
  const reread = useRef(() => {});
  useEffect(() => {
    let gone = false;
    const read = () =>
      invoke<Record<string, unknown>>("get_settings").then(
        (s) => !gone && ((disk.current = s), setError(null), setSettings(race.current.loaded(s))),
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
