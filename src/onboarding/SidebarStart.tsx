// VIEW-114: the sidebar's onboarding slot, mounted once in the sidebar above its footer
// (ProjectsPanel, coordinator patch evidence/accounts-FIX-3-sidebar.patch, held until T-333-b and
// reliability R2 land). It shows the newcomer checklist while that is up, else the Setup Guide entry
// while a core step remains; it renders nothing until its reads have answered, so it never flashes.
// It reads the steps again on every Setup Guide close, every added project and window focus once 30 s
// have passed since its last read of any kind (the read made when the guide switches on included),
// so a step done elsewhere ticks in place (FIX-2, FIX-3, FIX-4).
import { useEffect, useRef, useState } from "react";
import { useSettings } from "../settings/useSettings";
import Checklist, { useChecklistRecord } from "./Checklist";
import { EyeOff } from "../chrome/icons";
import { Ring, useGuideState } from "./Guides";
import { checklistHidden, HIDE_PATCH, openGuide } from "./guide";
import { checklistOf } from "./newcomer";
import { entryLine, guideWanted, onReread, rereadFloor, sidebarSlot } from "./sidebar";
import "./onboarding.css";

export default function SidebarStart() {
  const rec = useChecklistRecord();
  const [again, setAgain] = useState(0);
  const [asked, setAsked] = useState(false);
  const { save, error, settings } = useSettings();
  const floor = useRef(rereadFloor()).current;
  useEffect(() => onReread(window, () => setAgain((n) => n + 1), undefined, floor), [floor]);
  const first = rec === undefined ? undefined : (rec?.firstRun ?? null);
  const c = checklistOf(first, rec?.tried ?? []);
  const g = useGuideState(guideWanted(c, first), again, floor.stamp);
  const slot = sidebarSlot(c, first, g.settled);
  if (slot === "checklist") return <Checklist compact record={rec} />;
  // ONB-020: Hide from sidebar is remembered under its own flag (49-ux2: hiding is not completing; the old
  // setupChecklist false still reads as the legacy rule for profiles that saved it).
  // FIX-1: it is saved through the settings save in turn (merged with what is on disk), and when the save fails the
  // entry comes back with a short message instead of returning silently on the next launch.
  const failed = asked && error !== null;
  if ((asked && !failed) || checklistHidden(settings) || slot !== "guide" || !g.settled) return null;
  const line = entryLine(g.settled);
  const hide = () => {
    setAsked(true);
    void save(HIDE_PATCH).then(() => setAgain((n) => n + 1));
  };
  return (
    <div className="onb-entry">
      <button className="onb-open" onClick={() => openGuide(line.nextId ?? undefined)} title="Open Getting Started with Kolux">
        <Ring done={line.done} total={line.total} size={22} />
        <span className="text">
          <span className="name">Getting Started</span>
          <span className="about">
            {line.count} done{line.next ? ` · next: ${line.next}` : ""}
          </span>
        </span>
      </button>
      <button className="ib" title="Hide from sidebar" aria-label="Hide from sidebar" onClick={hide}>
        <EyeOff />
      </button>
      {failed && (
        <span className="about warn" role="status">
          Getting Started could not be hidden. Try again.
        </span>
      )}
    </div>
  );
}
