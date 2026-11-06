// T-546-c (OD-09): the main window's half of the Tower. It sends a snapshot whenever the seats or
// the usage cards change (and again when the Tower window says it is up), opens the pane a row names
// and brings the main window forward, and runs a Refresh asked for from the Tower window. It lives
// apart from TowerWindow so the main window does not pull the Tower's view into its first load.
import { useEffect, useRef } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { refreshAll } from "../usage/refresh";
import { snapshotChanged, TOWER_LABEL, TOWER_OPEN, TOWER_READY, TOWER_SNAPSHOT, type Snapshot } from "./ownWindow";

/** tower -> main: read every provider's usage now (the readers run in the main window). */
export const TOWER_REFRESH = "kolux-tower-refresh";

const off = (p: Promise<() => void>) => void p.then((u) => u()).catch(() => {});

/** The main window's half; `snap` is recomputed by the caller on every render, sends happen only on change. */
export function useTowerBridge(snap: Snapshot, onOpen: (key: number) => void): void {
  const last = useRef<Snapshot | null>(null);
  const latest = useRef(snap);
  latest.current = snap;
  const open = useRef(onOpen);
  open.current = onOpen;
  const send = (s: Snapshot) => {
    last.current = s;
    void emitTo(TOWER_LABEL, TOWER_SNAPSHOT, s).catch(() => {});
  };
  useEffect(() => {
    if (snapshotChanged(last.current, snap)) send(snap);
  });
  useEffect(() => {
    const uns = [
      listen(TOWER_READY, () => send(latest.current)),
      listen<number>(TOWER_OPEN, (e) => {
        open.current(e.payload);
        void getCurrentWindow().setFocus().catch(() => {});
      }),
      listen(TOWER_REFRESH, () => refreshAll()),
    ];
    return () => uns.forEach(off);
  }, []);
}
