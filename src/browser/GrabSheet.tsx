// T-240 (BROW-035): the details sheet of a grabbed page element. It covers the pane body (the page is hidden
// meanwhile): the element's picture, its rows, Copy details and Send to agent. Esc or Close shows the page again.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SendTarget } from "../editor/notes";
import { copyDetails, copyScreenshot, type Grab, leavesGrab, sendGrab } from "./grabFlow";
import { SendButton } from "./SendButton";

type Props = {
  grab: Grab;
  title: string;
  url: string;
  targets?: () => SendTarget[];
  onSend?: (key: number, text: string) => Promise<void> | void;
  /** `done` is a line for the pane's notice (what was sent), when something was. */
  onClose: (done?: string) => void;
};

export function GrabSheet({ grab, title, url, targets, onSend, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(grab.problem);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.focus();
  }, []);

  const copy = async () => setLine(await copyDetails((t) => navigator.clipboard.writeText(t), grab.pick));
  const copyShot = async () => setLine(await copyScreenshot((items) => navigator.clipboard.write(items), grab.picture));
  const send = async (key: number) => {
    setBusy(true);
    setLine(null);
    try {
      onClose(await sendGrab(invoke, onSend, key, grab, title, url));
    } catch (err) {
      setLine(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div
      ref={root}
      className="grab-sheet"
      role="dialog"
      aria-label="Grabbed element"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (!leavesGrab(e.key)) return;
        e.preventDefault();
        onClose();
      }}
    >
      <div className="draw-bar">
        <strong>Grabbed element</strong>
        <span className="draw-gap" />
        <button type="button" className="btn" data-go="copy" onClick={copy}>
          Copy details
        </button>
        <button type="button" className="btn" data-go="copy-shot" disabled={!grab.picture} onClick={copyShot} title={grab.picture ? "Put the picture on the clipboard" : "There is no picture"}>
          Copy screenshot
        </button>
        <SendButton targets={targets} busy={busy} onPick={send} />
        <button type="button" className="btn" data-go="close" onClick={() => onClose()} title="Back to the page (Esc)">
          Close
        </button>
      </div>
      {line && (
        <p className="draw-note" role="status">
          {line}
        </p>
      )}
      <div className="grab-body">
        {grab.picture && <img className="grab-picture" src={grab.picture} alt="The grabbed element" />}
        <dl className="grab-rows">
          {grab.rows.map((r) => (
            <div key={r.label} className="grab-row">
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
