// EDIT-029 / EDIT-030 (T-235-b): diagrams (a mermaid fence) and maths ($x$ inline, $$ blocks) in a note's
// preview. The drawing libraries are not part of the app yet (they need a new dependency), so this file holds
// everything around them and the libraries plug in through setRenderers(); until then a note shows its
// fences and dollar text as written.
//
// Safety: a diagram is drawn to an SVG string, cleaned, then shown inside an iframe with an EMPTY sandbox
// attribute (no scripts, no same-origin) and a page-level policy that allows nothing but inline styles and
// data pictures, so even a hostile diagram cannot run code or reach the app. Maths is turned into markup
// by the plugged-in renderer with trust off and its output is cleaned by the plugin (see the evidence file).
import DOMPurify from "dompurify";

export type Renderers = {
  /** Mermaid source to an SVG string. `dark` picks the theme. May throw on bad source. */
  mermaid?: (src: string, dark: boolean) => Promise<string>;
  /** TeX to HTML markup, already safe to insert. May throw on bad source. */
  math?: (tex: string, display: boolean) => string;
};

let current: Renderers = {};
const watchers = new Set<() => void>();

/** Plugs in the drawing libraries (called by diagramLibs.ts once they are installed). */
export function setRenderers(r: Renderers) {
  current = { ...current, ...r };
  watchers.forEach((w) => w());
}
export const getRenderers = (): Renderers => current;
export function watchRenderers(fn: () => void): () => void {
  watchers.add(fn);
  return () => void watchers.delete(fn);
}

let loading: Promise<void> | null = null;
/** Loads diagramLibs.ts when it exists (the optional file that imports mermaid and katex). */
export function loadRenderers(): Promise<void> {
  if (!loading) {
    const files = import.meta.glob("./diagramLibs.ts");
    const first = Object.values(files)[0];
    loading = first ? first().then(() => undefined, () => undefined) : Promise.resolve();
  }
  return loading;
}

/** The mermaid settings the plugin must use: nothing from the diagram's own directives can loosen them. */
export function mermaidConfig(dark: boolean) {
  return {
    startOnLoad: false,
    securityLevel: "strict" as const, // mermaid itself escapes labels and refuses click handlers
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    // Mermaid 12 made ELK the default layout and neo/redux the default look. Pin the Mermaid 11 look so no
    // diagram changes shape or style on upgrade; a diagram's own front matter can still ask for another.
    layout: "dagre" as const,
    look: "classic" as const,
    // T-601: a diagram that fails leaves no error picture (with its styles) in the app's own page.
    suppressErrorRendering: true,
    // T-601: what a diagram's own %%{init}%% or front matter may not set. mermaid's own five, plus the theme and the
    // font names, which reach the CSS mermaid puts into the app's page while it draws, and HTML labels.
    secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges", "theme", "themeVariables", "themeCSS", "fontFamily", "altFontFamily", "htmlLabels"],
    theme: dark ? ("dark" as const) : ("neutral" as const),
    themeVariables: dark
      ? { background: "transparent", primaryColor: "#2b3a55", primaryTextColor: "#e6e9ef", primaryBorderColor: "#6b86b8", lineColor: "#9aa7bf", secondaryColor: "#3a2f4f", tertiaryColor: "#243030", fontFamily: "system-ui, sans-serif" }
      : { background: "transparent", fontFamily: "system-ui, sans-serif" },
  };
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The size an SVG asks for: its viewBox, else its width and height; null when it says neither. */
export function svgSize(svg: string): { w: number; h: number } | null {
  const head = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)\s*["']/i.exec(head);
  if (vb && +vb[1] > 0 && +vb[2] > 0) return { w: +vb[1], h: +vb[2] };
  const w = /\swidth\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(head);
  const h = /\sheight\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(head);
  return w && h && +w[1] > 0 && +h[1] > 0 ? { w: +w[1], h: +h[1] } : null;
}

/** The page shown inside the diagram's iframe: the policy first, then only the cleaned SVG. */
export function sandboxDoc(svg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>html,body{margin:0;background:transparent}svg{display:block;max-width:100%;height:auto;margin:0 auto}</style></head><body>${svg}</body></html>`;
}

/** Removes scripts, event handlers, embedded HTML and links from an SVG string (DOMPurify's SVG profile). */
export function cleanSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "foreignObject", "a", "iframe", "object", "embed"],
    FORBID_ATTR: ["href", "xlink:href", "onload", "onclick"],
  });
}

/** What the iframe needs: the page text and a box shape that keeps the picture's proportions. */
export function diagramFrame(svg: string): { srcdoc: string; ratio: string; maxWidth: number } {
  const size = svgSize(svg);
  return { srcdoc: sandboxDoc(svg), ratio: size ? `${size.w} / ${size.h}` : "16 / 9", maxWidth: size ? Math.max(120, Math.round(size.w)) : 720 };
}

// ---- maths ----

export type MathItem = { tex: string; display: boolean; raw: string };

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
// $x$ : opens before a non-space, closes after a non-space, and is not followed by a digit ("$5 and $10" is money).
const INLINE = /(?<![\\$])\$(?!\s)((?:[^$\n\\]|\\.)+?)(?<!\s)\$(?![\d$])/g;

/** Swaps every maths span for a plain word-like placeholder so the markdown parser cannot mangle the TeX
 *  (underscores, stars, backslashes). Code fences and code spans are left alone. */
export function extractMath(md: string): { text: string; items: MathItem[] } {
  const items: MathItem[] = [];
  const hold = (tex: string, display: boolean, raw: string) => `KXMATH${items.push({ tex, display, raw }) - 1}X`;
  const lines = md.split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = FENCE.exec(line);
    if (fence) {
      out.push(line);
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      out.push(line);
      continue;
    }
    const t = line.trim();
    if (t.startsWith("$$")) {
      const one = /^\$\$(.+?)\$\$$/.exec(t);
      if (one) {
        out.push("", hold(one[1].trim(), true, t), "");
        continue;
      }
      if (t === "$$" || !t.slice(2).includes("$$")) {
        let j = i + 1;
        while (j < lines.length && !lines[j].includes("$$")) j++;
        if (j < lines.length) {
          const body = [t.slice(2), ...lines.slice(i + 1, j), lines[j].trim().replace(/\$\$\s*$/, "")];
          const raw = lines.slice(i, j + 1).join("\n");
          out.push("", hold(body.join("\n").trim(), true, raw), "");
          i = j;
          continue;
        }
      }
    }
    out.push(
      line
        .split(/(`+[^`]*`+)/)
        .map((part, k) => (k % 2 === 1 ? part : part.replace(INLINE, (m, tex: string) => hold(tex, false, m))))
        .join(""),
    );
  }
  return { text: out.join("\n"), items };
}

/** Puts the maths back into rendered HTML: the plugged-in renderer's markup, or (no renderer, or bad TeX)
 *  the original text so nothing the author wrote disappears. */
export function restoreMath(html: string, items: MathItem[], render: Renderers["math"] = getRenderers().math): string {
  if (items.length === 0) return html;
  const one = (it: MathItem): string => {
    if (render) {
      try {
        const out = render(it.tex, it.display);
        return it.display ? `<div class="md-math md-math-block">${out}</div>` : `<span class="md-math">${out}</span>`;
      } catch {
        /* falls through to the source text */
      }
    }
    return it.display ? `<pre class="md-math-src"><code>${esc(it.raw)}</code></pre>` : `<code class="md-math-src">${esc(it.raw)}</code>`;
  };
  return html
    .replace(/<p>KXMATH(\d+)X<\/p>/g, (m, n: string) => (items[+n]?.display ? one(items[+n]) : m))
    .replace(/KXMATH(\d+)X/g, (m, n: string) => (items[+n] ? one(items[+n]) : m));
}

/** The preview's whole pipeline: maths out, markdown, maths back in. */
export function renderNote(md: string, markdown: (md: string) => string): string {
  const { text, items } = extractMath(md);
  return restoreMath(markdown(text), items);
}

// ---- diagrams in the page ----

/** Replaces each mermaid code block under `root` with the drawn diagram (in the locked iframe). A diagram
 *  that fails keeps its code block and gets a one-line note above it. Does nothing without a renderer. */
export async function drawDiagrams(root: HTMLElement, dark = true, alive: () => boolean = () => true): Promise<void> {
  const draw = getRenderers().mermaid;
  if (!draw) return;
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("pre > code.language-mermaid"));
  for (const code of blocks) {
    const pre = code.parentElement;
    if (!pre || pre.dataset.drawn) continue;
    pre.dataset.drawn = "1";
    try {
      const svg = cleanSvg(await draw(code.textContent ?? "", dark));
      if (!alive() || !pre.isConnected) return;
      const f = diagramFrame(svg);
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", ""); // no scripts, no same-origin: the whole point
      frame.setAttribute("referrerpolicy", "no-referrer");
      frame.setAttribute("title", "Diagram");
      frame.className = "md-diagram";
      frame.style.aspectRatio = f.ratio;
      frame.style.maxWidth = `${f.maxWidth}px`;
      frame.srcdoc = f.srcdoc;
      pre.replaceWith(frame);
    } catch (err) {
      if (!alive() || !pre.isConnected) return;
      const note = document.createElement("div");
      note.className = "md-diagram-error";
      note.textContent = `Diagram could not be drawn: ${String(err instanceof Error ? err.message : err).split("\n")[0].slice(0, 160)}`;
      pre.before(note);
    }
  }
}
