// ONB-014, ONB-009 and ONB-032: the help menu's sheet — Getting Started, Explore Kolux, the wizard
// again, Milestones with its ring, and every tour by name. It loads the first time the help button is
// clicked (lazy/pages), so the guide's live steps, its ring and the tour catalogue stay out of the
// window's first frame.
import { milestonesShown, openExplore, openGuide, ring } from "./guide";
import { Ring, useGuideState } from "./Guides";
import { replayTour, TOURS } from "./tour";
import { REOPEN_WIZARD } from "./firstRun";

export default function HelpSheet({ at, onClose }: { at: { bottom: number; left: number }; onClose: () => void }) {
  const g = useGuideState(true);
  const r = ring(g.done);
  const pick = (go: () => void) => {
    onClose();
    go();
  };
  return (
    <>
      <div className="menu-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="menu" role="menu" aria-label="Help" style={at} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <button role="menuitem" className="menu-item" onClick={() => pick(() => openGuide())} autoFocus>
          Getting Started with Kolux
        </button>
        <button role="menuitem" className="menu-item" onClick={() => pick(openExplore)}>
          Explore Kolux
        </button>
        {/* ONB-009: the first-run wizard again. */}
        <button role="menuitem" className="menu-item" onClick={() => pick(() => window.dispatchEvent(new CustomEvent(REOPEN_WIZARD)))}>
          Onboarding
        </button>
        {milestonesShown(g.done) && (
          <button role="menuitem" className="menu-item" onClick={() => pick(() => openGuide())}>
            <Ring done={r.done} total={r.total} size={18} />
            Milestones
            <span className="menu-hint-inline">
              {r.done}/{r.total}
            </span>
          </button>
        )}
        {/* ONB-032: replay any tour, seen or not, whatever this launch already showed. */}
        <div className="menu-title">Tours</div>
        {TOURS.filter((t) => t.id !== "grid").map((t) => (
          <button key={t.id} role="menuitem" className="menu-item" title="Runs once its screen is showing" onClick={() => pick(() => replayTour(t.id))}>
            {t.name}
          </button>
        ))}
      </div>
    </>
  );
}
