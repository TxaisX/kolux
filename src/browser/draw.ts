// BROW-038: drawing on a page screenshot. Pure rules: the shapes, undo and redo, how a capture is
// scaled to fit a pixel budget, the one-time hint, how shapes are painted on a canvas and the message
// that sends a drawing to an agent. DrawCanvas.tsx is the canvas that uses them.
import { cleanUrl, maskSecrets } from "./scrub";

export type Tool = "rect" | "arrow" | "text";
export type Shape = { tool: Tool; x: number; y: number; w: number; h: number; text?: string };
/** `cleared` holds the marks Clear took away (one Undo brings them all back); `reclear` says Redo may clear them again. */
export type Drawing = { shapes: Shape[]; undone: Shape[]; cleared?: Shape[]; reclear?: boolean };

export const empty = (): Drawing => ({ shapes: [], undone: [] });

/** A new shape drops whatever was undone (the usual editor rule). */
export const add = (d: Drawing, s: Shape): Drawing => ({ shapes: [...d.shapes, s], undone: [] });

export const canUndo = (d: Drawing): boolean => d.shapes.length > 0 || !!d.cleared?.length;

export const canRedo = (d: Drawing): boolean => d.undone.length > 0 || !!d.reclear;

export function undo(d: Drawing): Drawing {
  if (d.shapes.length) return { ...d, shapes: d.shapes.slice(0, -1), undone: [...d.undone, d.shapes[d.shapes.length - 1]] };
  if (d.cleared?.length) return { shapes: d.cleared, undone: [], reclear: true };
  return d;
}

export function redo(d: Drawing): Drawing {
  if (d.undone.length) return { ...d, shapes: [...d.shapes, d.undone[d.undone.length - 1]], undone: d.undone.slice(0, -1) };
  if (d.reclear && d.shapes.length) return clearUndoable(d);
  return d;
}

/** A drag in any direction becomes a box with a positive size; an arrow keeps its direction. */
export const normalise = (tool: Tool, x0: number, y0: number, x1: number, y1: number): Shape =>
  tool === "arrow" ? { tool, x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { tool, x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };

/** The most pixels a capture may hold (a 4K screen at scale 1 fits; a scale 2 one is halved). */
export const PIXEL_BUDGET = 16_000_000;

/** The capture scales to try, largest first: the display's own, then smaller, each within the budget and 1..4. */
export function sizes(width: number, height: number, scale: number): number[] {
  const out: number[] = [];
  for (let s = Math.min(4, Math.max(1, Math.round(scale))); s >= 1; s--) if (width * height * s * s <= PIXEL_BUDGET) out.push(s);
  return out.length ? out : [1];
}

export const HINT_KEY = "kolux-draw-hint-seen";

/** The first drawing shows how (drag a box, A for arrow, T for text); after that it stays quiet. */
export const hintSeen = (store: Pick<Storage, "getItem"> | null): boolean => {
  try {
    return store?.getItem(HINT_KEY) === "1";
  } catch {
    return true;
  }
};

export const dismissHint = (store: Pick<Storage, "setItem"> | null): void => {
  try {
    store?.setItem(HINT_KEY, "1");
  } catch {
    /* a blocked store only means the hint shows again */
  }
};

export const TOOLS: readonly Tool[] = ["rect", "arrow", "text"];
/** The drawing's keys: R box, A arrow, T text. */
export const toolForKey = (key: string): Tool | null => ({ r: "rect", a: "arrow", t: "text" } as Record<string, Tool>)[key.toLowerCase()] ?? null;

/** Most characters one text mark keeps, and the most marks one drawing holds. */
export const TEXT_MAX = 200;
export const MAX_SHAPES = 60;
/** A drag shorter than this (in picture pixels) is a click, not a box or an arrow. */
export const MIN_DRAG = 4;

/** A finished drag becomes a shape; a click that is too small and a full drawing add nothing. */
export function finishDrag(d: Drawing, tool: Exclude<Tool, "text">, x0: number, y0: number, x1: number, y1: number): Drawing {
  const s = normalise(tool, x0, y0, x1, y1);
  if (Math.hypot(x1 - x0, y1 - y0) < MIN_DRAG || d.shapes.length >= MAX_SHAPES) return d;
  return add(d, s);
}

/** A text mark at a click; blank text adds nothing. */
export function addText(d: Drawing, x: number, y: number, text: string): Drawing {
  const t = Array.from(text.replace(/\s+/g, " ").trim()).slice(0, TEXT_MAX).join("");
  if (!t || d.shapes.length >= MAX_SHAPES) return d;
  return add(d, { tool: "text", x, y, w: 0, h: 0, text: t });
}

/** Everything off: nothing to redo either. */
export const clear = (): Drawing => empty();

/** UX audit: Clear that Undo can take back: one Undo restores every cleared mark, and Redo clears them again. */
export function clearUndoable(d: Drawing): Drawing {
  return d.shapes.length ? { shapes: [], undone: [], cleared: d.shapes } : d;
}

/** How much of the picture shows: its whole size, shrunk to fit the room (never enlarged). */
export function fitScale(picW: number, picH: number, roomW: number, roomH: number): number {
  if (!(picW > 0 && picH > 0 && roomW > 0 && roomH > 0)) return 1;
  return Math.min(1, roomW / picW, roomH / picH);
}

/** A point on the shown picture (pixels from its top left) in the picture's own pixels, kept inside it. */
export function toPicture(px: number, py: number, scale: number, picW: number, picH: number): { x: number; y: number } {
  const k = scale > 0 ? scale : 1;
  return { x: Math.min(picW, Math.max(0, px / k)), y: Math.min(picH, Math.max(0, py / k)) };
}

/** The two barb ends of an arrow's head, `len` long, 28 degrees either side of the shaft. */
export function arrowHead(s: Shape, len: number): [{ x: number; y: number }, { x: number; y: number }] {
  const ex = s.x + s.w;
  const ey = s.y + s.h;
  const back = Math.atan2(s.h, s.w) + Math.PI;
  const barb = (turn: number) => ({ x: ex + len * Math.cos(back + turn), y: ey + len * Math.sin(back + turn) });
  const wing = (28 * Math.PI) / 180;
  return [barb(wing), barb(-wing)];
}

/** The stroke width for a picture: thick enough to read on a 4K capture. */
export const strokeFor = (picW: number): number => Math.max(2, Math.round(picW / 500));
export const INK = "#ff5a00";

/** The part of a 2D canvas context the painter uses (so a test can record the calls). */
export type Ink = {
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textBaseline: CanvasTextBaseline;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fillText(t: string, x: number, y: number): void;
  measureText(t: string): { width: number };
  fillRect(x: number, y: number, w: number, h: number): void;
};

/** Paints the shapes in order. `unit` is the stroke width; text is `unit * 6` tall on a dark chip. */
export function paint(ctx: Ink, shapes: readonly Shape[], unit: number): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = unit;
  for (const s of shapes) {
    if (s.tool === "rect") ctx.strokeRect(s.x, s.y, s.w, s.h);
    else if (s.tool === "arrow") {
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + s.w, s.y + s.h);
      const [a, b] = arrowHead(s, unit * 6);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(s.x + s.w, s.y + s.h);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else if (s.text) {
      const size = unit * 6;
      ctx.font = `600 ${size}px system-ui, sans-serif`;
      ctx.textBaseline = "top";
      const w = ctx.measureText(s.text).width;
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(s.x, s.y, w + unit * 4, size + unit * 3);
      ctx.fillStyle = INK;
      ctx.fillText(s.text, s.x + unit * 2, s.y + unit * 1.5);
    }
  }
}

/** The shapes in words for the message: boxes and arrows by where they are, text marks quoted. */
export function describe(shapes: readonly Shape[], picW: number, picH: number): string[] {
  const pct = (n: number, of: number) => Math.round((n / of) * 100);
  return shapes.map((s, i) => {
    const at = `${pct(s.x, picW)}% across, ${pct(s.y, picH)}% down`;
    if (s.tool === "text") return `${i + 1}. text "${s.text}" at ${at}`;
    const size = `${pct(Math.abs(s.w), picW)}% by ${pct(Math.abs(s.h), picH)}%`;
    return s.tool === "rect" ? `${i + 1}. box ${size} at ${at}` : `${i + 1}. arrow from ${at} to ${pct(s.x + s.w, picW)}% across, ${pct(s.y + s.h, picH)}% down`;
  });
}

/** The message that goes to the agent: where the marked-up picture is and what is marked. */
export function drawMessage(a: { title: string; url: string; path: string; shapes: readonly Shape[]; width: number; height: number }): string {
  const bare = cleanUrl(a.url) ?? "";
  const name = maskSecrets(a.title) || bare;
  const lines = [`Marked-up screenshot of ${name} (${bare}), ${a.shapes.length} mark${a.shapes.length === 1 ? "" : "s"}.`, `Picture file: ${a.path}`];
  if (a.shapes.length) lines.push("", ...describe(a.shapes, a.width, a.height).map((l) => maskSecrets(l)));
  return lines.join("\n") + "\n";
}
