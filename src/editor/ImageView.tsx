// EDIT-029 (T-235-b): the tab a PNG, JPEG, GIF, WebP, BMP, ICO or AVIF file opens in. The bytes come through the
// app's bounded file-bytes read (the same fence as a text read), are shown from a blob address that is let go when
// the tab closes, and any failure is said in words (imageFiles.ts) instead of leaving an empty tab.
import { useKeymap } from "../keys/KeymapContext";
import { withChord } from "../terminal/PaneMenu";
import { labelOf } from "../keys/keymap";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Close } from "../chrome/icons";
import FileIcon from "./FileIcon";
import ImageCanvas from "./ImageCanvas";
import { baseName } from "./buffers";
import { mimeOf } from "./imageFiles";
import { readPicture } from "./pictureBytes";

type Props = { id: number; path: string; hidden?: boolean; focused?: boolean; onFocus?: () => void; onClose?: () => void; onToast?: (text: string) => void };

export default function ImageView({ id, path, hidden = false, focused = false, onFocus, onClose, onToast }: Props) {
  const keymap = useKeymap();
  const [src, setSrc] = useState<string | null>(null);
  const [bytes, setBytes] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    setSrc(null);
    setError(null);
    readPicture(path, invoke).then(
      (b) => {
        if (!alive) return;
        url = URL.createObjectURL(new Blob([b as BlobPart], { type: mimeOf(path) }));
        setBytes(b.byteLength);
        setSrc(url);
      },
      (e) => alive && setError(String(e instanceof Error ? e.message : e)),
    );
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, tries]);
  const name = baseName(path);
  return (
    <section className={`pane editor image${focused ? " focused" : ""}`} hidden={hidden} aria-label={`${name} pane`} onMouseDown={onFocus} data-kind="editor" data-key={id}>
      <header className="pane-head">
        <span className="agent-mark" title="Picture">
          <FileIcon name={name} size={13} />
        </span>
        <span className="title">{name}</span>
        <span className="path" title={path}>
          {path}
        </span>
        <button
          className="btn small"
          title="Copy the full path"
          aria-label="Copy the full path"
          onClick={() =>
            void navigator.clipboard.writeText(path).then(
              () => onToast?.("Path copied"),
              () => onToast?.("The path could not be copied; select it in the header instead."),
            )
          }
        >
          Copy path
        </button>
        {error && (
          <button className="btn small" title="Try loading the picture again" onClick={() => setTries((n) => n + 1)}>
            Retry
          </button>
        )}
        <span className="right">
          <button className="ib" onClick={() => onClose?.()} title={withChord("Close tab", labelOf(keymap, "tab.close"))}>
            <Close size={12} />
          </button>
        </span>
      </header>
      <ImageCanvas src={src} error={error} name={name} bytes={bytes} />
    </section>
  );
}
