// EDIT-003 (T-073): what an editor tab shows when its file changed on disk while it held unsaved
// edits: the banner (Reload / Keep my edits / Compare), the toast after a Reload that offers Undo,
// and the Compare view, two columns with the disk copy on the left and the tab's text on the
// right, drawn with the same merge view the diff tab's two-column layout uses (DiffPane.tsx). The
// Compare view reads the disk copy itself, so a failed read shows as the reason on the left side,
// and its own Reload and Keep my edits buttons close it.
import { useEffect, useRef, useState } from "react";
import { basicSetup } from "codemirror";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { currentDark } from "../theme";
import { codeHighlighting, editorMode } from "./syntax";
import { MergeView } from "@codemirror/merge";
import { baseName } from "./buffers";
import { goneText } from "./diskChange";
import { look } from "./EditorPane";

export function GoneNotice({ path }: { path: string }) {
  return (
    <div className="notice save-stale file-gone" role="alert" aria-label="File gone from disk">
      <span>{goneText(baseName(path))}</span>
    </div>
  );
}

export function DiskBanner({ path, onReload, onKeep, onCompare }: { path: string; onReload: () => void; onKeep: () => void; onCompare: () => void }) {
  return (
    <div className="notice save-stale disk-changed" role="alert" aria-label="Changed on disk">
      <span>{`${baseName(path)} changed on disk. Your unsaved edits are still here.`}</span>
      <button className="btn" title="Take the disk copy; Undo in the toast or Ctrl+Z brings your edits back" onClick={onReload}>
        Reload
      </button>
      <button className="btn" title="Hide this until the file changes again" onClick={onKeep}>
        Keep my edits
      </button>
      <button className="btn" title="Disk copy on the left, your text on the right" onClick={onCompare}>
        Compare
      </button>
    </div>
  );
}

// .notice.md-banner pushes every button right (margin-left: auto); the ones after the first sit beside it.
const next = { marginLeft: 0 } as const;

export function UndoToast({ path, onUndo, onClose }: { path: string; onUndo: () => void; onClose: () => void }) {
  return (
    <div className="notice md-banner disk-undo" role="status">
      <span>{`Reloaded ${baseName(path)} from disk.`}</span>
      <button className="btn" onClick={onUndo} title="Bring back the text from before the reload">
        Undo
      </button>
      <button className="btn" style={next} onClick={onClose} title="Dismiss">
        OK
      </button>
    </div>
  );
}

const heading = { flex: 1, minWidth: 0, padding: "2px 10px", fontSize: 12, color: "var(--fg-muted)" } as const;

/** `read` fetches the disk copy (file_read); `text` is the tab's text as it is now. */
export function CompareView({ path, text, read, onReload, onKeep, onClose }: { path: string; text: string; read: () => Promise<string>; onReload: () => void; onKeep: () => void; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [disk, setDisk] = useState<{ text: string } | { error: string } | null>(null);
  useEffect(() => {
    let alive = true;
    read().then(
      (t) => alive && setDisk({ text: t }),
      (err) => alive && setDisk({ error: String(err) }),
    );
    return () => void (alive = false);
  }, [path, read]);
  useEffect(() => {
    if (!disk || !host.current) return;
    const ro = [basicSetup, look, codeHighlighting, editorMode(currentDark()), EditorState.readOnly.of(true), EditorView.editable.of(false)];
    if ("text" in disk) {
      const m = new MergeView({ a: { doc: disk.text, extensions: ro }, b: { doc: text, extensions: ro }, parent: host.current, gutter: true });
      return () => m.destroy();
    }
    const v = new EditorView({ doc: text, extensions: ro, parent: host.current });
    return () => v.destroy();
  }, [disk, text]);
  const failed = disk && "error" in disk ? disk.error : null;
  return (
    <div className="pane-body compare-view" role="region" aria-label={`Compare ${baseName(path)} with disk`} style={{ display: "flex", flexDirection: "column" }}>
      <div className="notice md-banner compare-bar" style={{ margin: "6px 8px" }}>
        <span>{`Comparing ${baseName(path)}: disk copy on the left, your edits on the right.`}</span>
        <button className="btn" onClick={onReload} title="Take the disk copy and close">
          Reload
        </button>
        <button className="btn" style={next} onClick={onKeep} title="Keep your edits and close">
          Keep my edits
        </button>
        <button className="btn" style={next} onClick={onClose} title="Close without choosing">
          Close
        </button>
      </div>
      <div style={{ display: "flex", borderBottom: "1px solid var(--line-subtle)" }}>
        <span className="compare-head disk" style={heading}>
          Disk copy
        </span>
        <span className="compare-head mine" style={heading}>
          Your edits
        </span>
      </div>
      {failed ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <div className="compare-failed" role="alert" style={{ flex: 1, minWidth: 0, padding: 10, fontSize: 12, color: "var(--fg-muted)", borderRight: "1px solid var(--line-subtle)", overflowWrap: "anywhere" }}>
            The disk copy could not be read: {failed}
          </div>
          <div ref={host} className="diff-body" style={{ flex: 1, minWidth: 0 }} />
        </div>
      ) : (
        <div ref={host} className="diff-body" style={{ flex: 1, minHeight: 0 }} />
      )}
    </div>
  );
}
