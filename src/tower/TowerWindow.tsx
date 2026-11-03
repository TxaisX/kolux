// T-546-c (OD-09): both ends of the Tower's own window.
//  - TowerWindow: what main.tsx draws in the window labelled "tower" (address #tower-window). It
//    shows the snapshot the main window sends, asks for one as soon as it is up, sends a clicked row
//    back to the main window, and asks the main window to read the usage figures again on Refresh.
//  - useTowerBridge: the main window's half. It sends a snapshot whenever the seats or the usage
//    cards change (and again when the Tower window says it is up), opens the pane a row names and
//    brings the main window forward, and runs a Refresh asked for from the Tower window.
import { useEffect, useRef, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { refreshAll } from "../usage/refresh";
import TowerView from "./TowerView";
import { towerRows } from "./tower";
import { snapshotChanged, TOWER_LABEL, TOWER_OPEN, TOWER_READY, TOWER_SNAPSHOT, type Snapshot } from "./ownWindow";

/** tower -> main: read every provider's usage now (the readers run in the main window). */
export const TOWER_REFRESH = "kolux-tower-refresh";
const MAIN = "main";

const off = (p: Promise<() => void>) => void p.then((u) => u()).catch(() => {});

export default function TowerWindow() {
  const [snap, setSnap] = useState<Snapshot>({ seats: [], usage: [] });
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const un = listen<Snapshot>(TOWER_SNAPSHOT, (e) => (setSnap(e.payload), setLoaded(true)));
    void un.then(() => emitTo(MAIN, TOWER_READY)).catch(() => {});
    return () => {
      window.clearInterval(tick);
      off(un);
    };
  }, []);
  return (
    <div className="tower-window">
      <TowerView rows={towerRows(snap.seats)} usage={snap.usage} now={now} loading={!loaded} detached onOpen={(key) => void emitTo(MAIN, TOWER_OPEN, key).catch(() => {})} onRefresh={() => void emitTo(MAIN, TOWER_REFRESH).catch(() => {})} />
    </div>
  );
}

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
