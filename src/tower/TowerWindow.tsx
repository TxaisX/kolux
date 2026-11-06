// T-546-c (OD-09): both ends of the Tower's own window.
//  - TowerWindow: what main.tsx draws in the window labelled "tower" (address #tower-window). It
//    shows the snapshot the main window sends, asks for one as soon as it is up, sends a clicked row
//    back to the main window, and asks the main window to read the usage figures again on Refresh.
//  - useTowerBridge lives in bridge.ts, so the main window's first load does not carry this view.
import { useEffect, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import TowerView from "./TowerView";
import { towerRows } from "./tower";
import { TOWER_OPEN, TOWER_READY, TOWER_SNAPSHOT, type Snapshot } from "./ownWindow";
import { TOWER_REFRESH } from "./bridge";

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

