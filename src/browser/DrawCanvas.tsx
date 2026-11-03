// T-241 (BROW-038): the drawing canvas. The page's picture (from the engine) fills the pane body, the
// page itself is hidden meanwhile; boxes, arrows and text go on it, and the marked-up picture is sent
// to an agent as a file path. The rules (shapes, undo, painting, the message) are in draw.ts.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SendTarget } from "../editor/notes";
import { useArm } from "./arm";
import { addText, clearUndoable, dismissHint, drawMessage, type Drawing, empty, finishDrag, fitScale, hintSeen, paint, redo, type Shape, strokeFor, type Tool, toolForKey, toPicture, TOOLS, undo } from "./draw";
import { asDataUrl, type Picture, sendPicture } from "./picture";
import { SendButton } from "./SendButton";

type Props = {
  picture: Picture;
  title: string;
  url: string;
  targets?: () => SendTarget[];
  onSend?: (key: number, text: string) => Promise<void> | void;
  /** `done` is a line for the pane's notice (what was sent), when something was. */
  onClose: (done?: string) => void;
};

const LABEL: Record<Tool, string> = { rect: "Box", arrow: "Arrow", text: "Text" };
const KEY: Record<Tool, string> = { rect: "R", arrow: "A", text: "T" };

const store = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export function DrawCanvas({ picture, title, url, targets, onSend, onClose }: Props) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [drawing, setDrawing] = useState<Drawing>(empty);
  const [tool, setTool] = useState<Tool>("rect");
  const [drag, setDrag] = useState<{ x: number; y: number; to: { x: number; y: number } } | null>(null);
  const [typing, setTyping] = useState<{ x: number; y: number } | null>(null);
  const [room, setRoom] = useState({ w: 0, h: 0 });
  const [hint, setHint] = useState(() => !hintSeen(store()));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // UX audit: the text box is committed by blur too, once; this mirror says whether one is still open (blur can follow Enter's unmount).
  const typingAt = useRef<{ x: number; y: number } | null>(null);
  const [leaveArmed, pressLeave] = useArm();
  const marks = drawing.shapes.length;
  // Close and Esc with marks on the picture ask once more: leaving drops them.
  const leave = () => (marks ? pressLeave(() => onClose()) : onClose());

  useEffect(() => {
    const i = new Image();
    i.onload = () => setImg(i);
    i.onerror = () => setProblem("The page's picture could not be shown");
    i.src = asDataUrl(picture);
  }, [picture]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setRoom({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const o = new ResizeObserver(measure);
    o.observe(el);
    return () => o.disconnect();
  }, []);

  const w = img?.naturalWidth ?? 0;
  const h = img?.naturalHeight ?? 0;
  const scale = fitScale(w, h, room.w, room.h);
  const live: Shape[] = drag && tool !== "text" ? [{ tool, x: drag.x, y: drag.y, w: drag.to.x - drag.x, h: drag.to.y - drag.y }] : [];

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || !img) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    paint(ctx, [...drawing.shapes, ...live], strokeFor(w));
  });

  const where = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top, ...toPicture(e.clientX - r.left, e.clientY - r.top, scale, w, h) };
  };
  const down = (e: React.PointerEvent) => {
    if (!img || busy) return;
    const p = where(e);
    if (tool === "text") return openText({ x: p.x, y: p.y });
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ x: p.x, y: p.y, to: { x: p.x, y: p.y } });
  };
  const move = (e: React.PointerEvent) => {
    if (drag) setDrag({ ...drag, to: where(e) });
  };
  const up = (e: React.PointerEvent) => {
    if (!drag || tool === "text") return;
    const p = where(e);
    const next = finishDrag(drawing, tool, drag.x, drag.y, p.x, p.y);
    setDrag(null);
    if (next !== drawing) shapeAdded(next);
  };
  const shapeAdded = (next: Drawing) => {
    setDrawing(next);
    if (hint) {
      dismissHint(store());
      setHint(false);
    }
  };
  const openText = (at: { x: number; y: number }) => {
    typingAt.current = at;
    setTyping(at);
  };
  const closeText = () => {
    typingAt.current = null;
    setTyping(null);
  };
  const commitText = (value: string) => {
    const at = typingAt.current;
    if (at) {
      const next = addText(drawing, at.x, at.y, value);
      if (next !== drawing) shapeAdded(next);
    }
    closeText();
  };

  const keys = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === "z") setDrawing(e.shiftKey ? redo(drawing) : undo(drawing));
    else if (ctrl && e.key.toLowerCase() === "y") setDrawing(redo(drawing));
    else if (e.key === "Escape") leave();
    else if (!ctrl && toolForKey(e.key)) setTool(toolForKey(e.key)!);
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    stage.current?.focus();
  }, [img]);

  const send = async (key: number) => {
    if (!img) return;
    setBusy(true);
    setProblem(null);
    try {
      const out = document.createElement("canvas");
      out.width = w;
      out.height = h;
      const ctx = out.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      paint(ctx, drawing.shapes, strokeFor(w));
      const name = title || "page";
      await sendPicture(invoke, onSend, key, { dataUrl: out.toDataURL("image/png"), name, text: (path) => drawMessage({ title, url, path, shapes: drawing.shapes, width: w, height: h }) });
      onClose(`Drawing sent (${drawing.shapes.length} mark${drawing.shapes.length === 1 ? "" : "s"})`);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="draw-canvas" role="dialog" aria-label="Draw on the page" onKeyDown={keys}>
      <div className="draw-bar">
        {TOOLS.map((t) => (
          <button key={t} type="button" className={`btn${tool === t ? " on" : ""}`} data-tool={t} aria-pressed={tool === t} title={`${LABEL[t]} (${KEY[t]})`} onClick={() => setTool(t)}>
            {LABEL[t]}
          </button>
        ))}
        <span className="draw-gap" />
        <button type="button" className="btn" data-go="undo" disabled={!drawing.shapes.length} onClick={() => setDrawing(undo(drawing))} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button type="button" className="btn" data-go="redo" disabled={!drawing.undone.length} onClick={() => setDrawing(redo(drawing))} title="Redo (Ctrl+Shift+Z)">
          Redo
        </button>
        <button type="button" className="btn" data-go="clear" disabled={!drawing.shapes.length} onClick={() => setDrawing(clearUndoable(drawing))} title="Clear every mark (Undo brings them back)">
          Clear
        </button>
        <span className="draw-gap" />
        <SendButton targets={targets} busy={busy} onPick={send} />
        <button type="button" className="btn" data-go="close" onClick={leave} title={leaveArmed ? "Press again to leave and drop the marks" : "Back to the page (Esc)"}>
          {leaveArmed ? "Discard marks?" : "Close"}
        </button>
      </div>
      {(hint || problem) && (
        <p className="draw-note" role={problem ? "alert" : "status"}>
          {problem ?? "Drag to draw a box. Press A for an arrow, T for text, Ctrl+Z to undo."}
        </p>
      )}
      <div ref={stage} className="draw-stage" tabIndex={-1}>
        {img && (
          <div className="draw-sheet" style={{ width: w * scale, height: h * scale }}>
            <canvas ref={canvas} width={w} height={h} style={{ width: w * scale, height: h * scale }} onPointerDown={down} onPointerMove={move} onPointerUp={up} data-tool={tool} />
            {typing && (
              <input
                className="draw-text"
                autoFocus
                maxLength={200}
                style={{ left: typing.x * scale, top: typing.y * scale }}
                aria-label="Text on the picture"
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitText(e.currentTarget.value);
                  else if (e.key === "Escape") closeText();
                  e.stopPropagation();
                }}
                onBlur={(e) => commitText(e.currentTarget.value)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
