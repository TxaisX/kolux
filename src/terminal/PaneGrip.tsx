// TERM-015: the drag handle at the start of a pane header. Dragging it moves the pane to another cell of the grid
// (Grid.tsx drops it: the centre swaps the two panes, an outer band puts it on that side). One session per cell
// (owner decision 2026-11-12): every pane kind's header carries it, as every tab of the old strip could be dragged.
export default function PaneGrip({ name, onStart, onEnd }: { name: string; onStart: () => void; onEnd: () => void }) {
  return (
    <span
      className="pane-grip"
      role="img"
      aria-label="Drag to move this pane"
      title="Drag to move this pane"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", name);
        onStart();
      }}
      onDragEnd={onEnd}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
        <circle cx="4" cy="3" r="1" />
        <circle cx="8" cy="3" r="1" />
        <circle cx="4" cy="6" r="1" />
        <circle cx="8" cy="6" r="1" />
        <circle cx="4" cy="9" r="1" />
        <circle cx="8" cy="9" r="1" />
      </svg>
    </span>
  );
}
