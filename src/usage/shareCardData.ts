// USAGE-019: the usage card as a picture and as a post. The figures are the user's own, taken from
// the rows the panel is already showing; nothing here sends anything anywhere. The post is only a
// link the system browser opens (the existing open_external command), and the picture is drawn on a
// canvas and handed to the clipboard. Pure functions, so the figures, the words and the drawing are
// all testable without a window.
import { locale } from "../language";
import { compactCount, formatDayMedium as dayText } from "./format";
import { estimate } from "./pricing";
import { byModel, daily, localDay, NAMES, rangeStart, tokensOf, type Provider, type Range, type Row } from "./tokens";

export const CARD_W = 1200;
export const CARD_H = 630;

export type CardData = {
  provider: Provider;
  providerName: string;
  rangeLabel: string;
  /** "Oct 13, 2026 – Oct 19, 2026". */
  dates: string;
  /** Total tokens, compact (4.5M). */
  tokens: string;
  /** Estimated cost: two decimals, four below one cent, or n/a when no price is known. A trailing + means some models had no price and are left out. */
  cost: string;
  /** True when the cost leaves out models with no known price (the figure is a floor). */
  partial: boolean;
  topModel: string | null;
  /** Tokens for each day of the range (weekly past a year), oldest first. */
  bars: number[];
};

const RANGE_WORDS: Record<Range, string> = { "7": "Last 7 days", "30": "Last 30 days", "90": "Last 90 days", all: "All time" };

/** USAGE-019: a cost below one cent shows four decimal places and a missing cost shows n/a. */
export function costText(usd: number, priced: boolean, loc: string = locale()): string {
  if (!priced || !Number.isFinite(usd)) return "n/a";
  const digits = usd > 0 && usd < 0.01 ? 4 : 2;
  return new Intl.NumberFormat(loc, { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(usd);
}

/** The card for one provider's rows, already narrowed to the panel's range and scope. */
export function cardOf(provider: Provider, rows: Row[], range: Range, today: Date, loc: string = locale()): CardData {
  const first = range === "all" ? rows.reduce((m, r) => (r.day < m ? r.day : m), localDay(today)) : rangeStart(range, today);
  const est = estimate(provider, rows);
  const priced = rows.length > 0 && !(est.usd === 0 && est.unpriced.length > 0);
  const partial = priced && est.unpriced.length > 0;
  const total = rows.reduce((t, r) => t + tokensOf(r), 0);
  return {
    provider,
    providerName: NAMES[provider],
    rangeLabel: RANGE_WORDS[range],
    dates: `${dayText(first, loc)} – ${dayText(localDay(today), loc)}`,
    tokens: compactCount(total, loc),
    cost: costText(est.usd, priced, loc) + (partial ? "+" : ""),
    partial,
    topModel: byModel(provider, rows)[0]?.model ?? null,
    bars: daily(rows, range, today).map((b) => b.tokens),
  };
}

/** The ready-written post: provider, range, total tokens and cost. */
export function postText(c: CardData): string {
  const spend = c.cost === "n/a" ? "cost n/a" : c.partial ? `at least ${c.cost.slice(0, -1)}` : `about ${c.cost}`;
  return `${c.providerName} usage, ${c.rangeLabel.toLowerCase()}: ${c.tokens} tokens, ${spend}. Tracked with Kolux.`;
}

/** The X post-composer link the browser opens (a web address only; X's own page does the posting). */
export const xUrl = (c: CardData): string => `https://x.com/intent/post?text=${encodeURIComponent(postText(c))}`;

const INK = "#fafafa";
const DIM = "#9a9a9a";
const FAINT = "#6a6a6a";
const BAR = "#8beeb0";
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
// The app mark (the six-spoke glyph in src/chrome/icons.tsx), drawn from the same path on a 24-unit grid.
const SPOKE = "M1.3 -.13C2.3 -.13 2.7 -.84 3.3 -.84H5.9A.84 .84 0 0 1 5.9 .84H3.3C2.7 .84 2.3 .13 1.3 .13Z";

function fit(ctx: CanvasRenderingContext2D, s: string, max: number): string {
  if (ctx.measureText(s).width <= max) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  if (typeof Path2D === "undefined") return;
  const spoke = new Path2D(SPOKE);
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = INK;
  ctx.rotate(Math.PI / 6);
  for (let i = 0; i < 6; i++) {
    ctx.fill(spoke);
    ctx.rotate(Math.PI / 3);
  }
  ctx.beginPath();
  ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Draws the card on a CARD_W by CARD_H canvas. `mark` is the provider's vendor mark once loaded (null draws the name alone). */
export function drawCard(ctx: CanvasRenderingContext2D, c: CardData, mark: CanvasImageSource | null): void {
  ctx.fillStyle = "#0d0d0d";
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.strokeStyle = "#2a2a2a";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, CARD_W - 2, CARD_H - 2);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  drawMark(ctx, 64, 56, 44);
  ctx.fillStyle = INK;
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText("Kolux", 120, 90);

  let x = CARD_W - 64;
  ctx.textAlign = "right";
  ctx.font = `500 30px ${FONT}`;
  ctx.fillText(c.providerName, x, 90);
  if (mark) {
    x -= ctx.measureText(c.providerName).width + 14 + 40;
    ctx.drawImage(mark, x, 56, 40, 40);
  }
  ctx.textAlign = "left";

  ctx.fillStyle = DIM;
  ctx.font = `500 26px ${FONT}`;
  ctx.fillText(c.rangeLabel, 64, 170);
  ctx.fillStyle = FAINT;
  ctx.font = `400 22px ${FONT}`;
  ctx.fillText(c.dates, 64, 204);

  ctx.fillStyle = INK;
  ctx.font = `700 96px ${FONT}`;
  ctx.fillText(c.tokens, 64, 320);
  ctx.fillText(c.cost, 640, 320);
  ctx.fillStyle = DIM;
  ctx.font = `400 22px ${FONT}`;
  ctx.fillText("tokens", 64, 354);
  ctx.fillText(c.partial ? "estimated cost, unpriced models left out" : "estimated cost", 640, 354);
  if (c.topModel) {
    ctx.fillStyle = FAINT;
    ctx.fillText("Most used", 64, 408);
    ctx.fillStyle = INK;
    ctx.font = `500 26px ${FONT}`;
    ctx.fillText(fit(ctx, c.topModel, CARD_W - 128 - 150), 214, 408);
  }

  // a strip of daily tokens along the bottom
  const left = 64;
  const width = CARD_W - 128;
  const top = 450;
  const height = 120;
  const peak = Math.max(1, ...c.bars);
  const n = Math.max(1, c.bars.length);
  const gap = n > 60 ? 1 : 3;
  const bw = Math.max(1, (width - gap * (n - 1)) / n);
  ctx.fillStyle = BAR;
  c.bars.forEach((t, i) => {
    const h = t > 0 ? Math.max(3, (t / peak) * height) : 2;
    ctx.globalAlpha = t > 0 ? 1 : 0.25;
    ctx.fillRect(left + i * (bw + gap), top + height - h, bw, h);
  });
  ctx.globalAlpha = 1;
  ctx.fillStyle = FAINT;
  ctx.font = `400 20px ${FONT}`;
  ctx.fillText("Daily tokens", 64, 604);
}

type ClipLike = { write: (items: ClipboardItem[]) => Promise<void> };

/** Puts the canvas on the clipboard as a PNG. True when it did; false when the picture could not be made or the clipboard refused. */
export async function copyPng(canvas: HTMLCanvasElement, clip: ClipLike | undefined, Item: typeof ClipboardItem | undefined): Promise<boolean> {
  if (!clip || !Item) return false;
  try {
    // toBlob can throw (a tainted canvas raises SecurityError), so it sits inside the try with the clipboard write
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return false;
    await clip.write([new Item({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}
