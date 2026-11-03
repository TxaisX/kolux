// USAGE-019: the Share dialog on the Claude and Codex usage panels. It previews the card, Copy image
// puts the picture on the clipboard (the button reads Copied for about two seconds), and Share on X
// opens a ready-written post in the browser through the existing link opener. The card shows only the
// user's own numbers and nothing is sent by Kolux. Closing while the picture is still being made
// leaves nothing running that touches the dialog afterwards.
import { useEffect, useMemo, useRef, useState } from "react";
import { useDialogFocus } from "../chrome/dialogFocus";
import { invoke } from "@tauri-apps/api/core";
import { vendorMark, vendorUrl } from "../marks/registry";
import ShareButton from "./ShareButton";
import { CARD_H, CARD_W, cardOf, copyPng, drawCard, xUrl } from "./shareCardData";
import type { Provider, Range, Row } from "./tokens";

type Props = {
  provider: Provider;
  /** The rows the panel is showing (already narrowed to its range and scope). */
  rows: Row[];
  range: Range;
  today: Date;
  onClose: () => void;
};

const COPIED_MS = 2000;
const box = { display: "flex", flexDirection: "column", gap: 12, padding: "16px 18px", width: "min(720px, calc(100vw - 48px))", maxHeight: "calc(100vh - 48px)", overflow: "auto", background: "var(--pane-bg)", border: "1px solid var(--line-focus)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0, 0, 0, 0.5)", color: "var(--fg)" } as const;

export default function ShareCard({ provider, rows, range, today, onClose }: Props) {
  const card = useMemo(() => cardOf(provider, rows, range, today), [provider, rows, range, today]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [copy, setCopy] = useState<"idle" | "busy" | "done" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  // The picture: drawn at once without the vendor mark, then again once the mark has loaded.
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    drawCard(ctx, card, null);
    const entry = vendorMark(provider);
    const url = entry ? vendorUrl(entry.dark) : undefined;
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      if (alive.current && canvas.current === ctx.canvas) drawCard(ctx, card, img);
    };
    img.src = url;
    return () => {
      img.onload = null;
    };
  }, [card, provider]);

  // usage-status.md:9: focus moves into the dialog, Tab stays inside, Escape closes it from anywhere, and focus goes back to Share.
  useDialogFocus(dialog, onClose);

  const onCopy = async () => {
    if (!canvas.current || copy === "busy") return;
    setCopy("busy");
    const ok = await copyPng(canvas.current, typeof navigator === "undefined" ? undefined : navigator.clipboard, typeof ClipboardItem === "undefined" ? undefined : ClipboardItem);
    if (!alive.current) return;
    setCopy(ok ? "done" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => alive.current && setCopy("idle"), COPIED_MS);
  };

  const onShare = () => {
    setError(null);
    invoke("open_external", { url: xUrl(card) }).catch((e) => alive.current && setError(String(e)));
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-label={`Share ${card.providerName} usage`} style={box}>
        <canvas ref={canvas} width={CARD_W} height={CARD_H} aria-label={`${card.providerName} usage card, ${card.rangeLabel}`} style={{ width: "100%", height: "auto", aspectRatio: `${CARD_W} / ${CARD_H}`, borderRadius: 8 }} />
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <button type="button" className="btn" onClick={() => void onCopy()} disabled={copy === "busy"}>
            {copy === "done" ? "Copied" : copy === "failed" ? "Couldn't copy" : "Copy image"}
          </button>
          <ShareButton onShare={onShare} />
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        {error && (
          <p role="alert" style={{ margin: 0, fontSize: 12, color: "var(--danger, #e5484d)" }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
