// BROW-001 used to be the browser pane: an address bar, the back end's web view laid over this body,
// its menus, keys, drawing and notes. Goal 0 (Txais, 2026-11-12) retires all of that, because the app
// draws no web pages any more and the web view was the single largest cost in the window (about 509 MB
// across six processes, docs/research/kolux-slimdown-2026-11-09.md).
//
// What is left exists only because the window shell still routes a tab of kind "browser" here. It
// draws a note and an Open button: no web view, no browser IPC, nothing fetched, nothing kept warm.
// Pane.tsx hands new addresses to the system browser directly (src/open/openExternal.ts), so this
// should almost never appear; c3-terminal deletes the last callers and then this file goes too.
import { useState } from "react";
import { openExternal } from "../open/openExternal";

type Props = {
  id?: number;
  url?: string;
  title?: string;
  hidden?: boolean;
  focused?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
  cwd?: string | null;
  targets?: () => unknown;
  onSend?: (key: number, text: string) => unknown;
  restored?: boolean;
};

export default function BrowserPane({ url, hidden = false, onClose }: Props) {
  const [said, setSaid] = useState<string | null>(null);
  if (hidden) return null;
  return (
    <div className="browser-gone" data-pane="browser-gone" style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start", justifyContent: "center", height: "100%", padding: 24, color: "var(--text-dim)" }}>
      <p style={{ margin: 0 }}>Kolux no longer shows web pages itself, so this tab opens addresses in your own browser.</p>
      {url && <p style={{ margin: 0, wordBreak: "break-all", color: "var(--text)" }}>{url}</p>}
      {said && <p style={{ margin: 0, color: "var(--bad)" }}>{said}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="btn"
          disabled={!url}
          onClick={() => {
            if (!url) return;
            setSaid(null);
            void openExternal(url).catch((err) => setSaid(String(err)));
          }}
        >
          Open in your browser
        </button>
        {onClose && (
          <button type="button" className="btn" onClick={() => onClose()}>
            Close Tab
          </button>
        )}
      </div>
    </div>
  );
}
