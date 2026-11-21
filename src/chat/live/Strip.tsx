// The artifacts strip (T-965): the files an agent left in `<chat folder>/artifacts`, newest first,
// sitting under the last finished turn the way the "Files written" box does (CHAT-028). A picture is a
// thumbnail that opens a large preview; a page or a video is a card whose one action opens the real
// file in the program the user has for it. Nothing here decides what is safe: Rust did, and a row that
// reached this file already passed its checks.
import { ago, sizeLabel, type ArtifactKind, type ArtifactRow } from "./artifacts";

/** A kind's own word, shown on a card with no picture. */
const KIND_LABEL: Record<ArtifactKind, string> = { image: "Picture", page: "Page", video: "Video" };

export function ArtifactsStrip({ rows, skipped, thumbs, now, onOpen, onPreview }: {
  /** At most four, newest first (`newest` in artifacts.ts did the picking). */
  rows: readonly ArtifactRow[];
  /** One plain sentence per limit that left files out; empty when nothing was held back. */
  skipped: readonly string[];
  /** The thumbnail URL of each picture that has been read, by its path. */
  thumbs: ReadonlyMap<string, string>;
  /** When the pane last looked, so "3 min ago" moves without a timer of its own. */
  now: number;
  /** Hand the real file to the program the user has for it. */
  onOpen: (row: ArtifactRow) => void;
  /** Show a picture large, inside the pane. */
  onPreview: (row: ArtifactRow) => void;
}) {
  if (rows.length === 0 && skipped.length === 0) return null;
  return (
    <div className="chat-artifacts" role="group" aria-label="Artifacts">
      {rows.length > 0 && (
        <>
          <div className="chat-artifacts-title">Artifacts</div>
          <ul>
            {rows.map((r) => {
              const thumb = r.kind === "image" ? thumbs.get(r.path) : undefined;
              return (
                <li key={r.path}>
                  <button type="button" className="chat-artifact" onClick={() => (r.kind === "image" ? onPreview(r) : onOpen(r))} title={r.kind === "image" ? `Show ${r.name}` : `Open ${r.name}`}>
                    {thumb ? <img className="chat-artifact-thumb" src={thumb} alt="" /> : <span className={`chat-artifact-kind kind-${r.kind}`}>{KIND_LABEL[r.kind]}</span>}
                    <span className="chat-artifact-name">{r.name}</span>
                    <span className="chat-artifact-meta">
                      {r.kind === "image" ? ago(r.mtime, now) : `${sizeLabel(r.size)} · ${ago(r.mtime, now)}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {skipped.map((line) => (
        <p className="chat-artifacts-skip" key={line}>{line}</p>
      ))}
    </div>
  );
}
