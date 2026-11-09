import { afterEach, describe, expect, it, vi } from "vitest";
import { marked } from "marked";
import { diagramFrame, extractMath, getRenderers, loadRenderers, mermaidConfig, renderNote, restoreMath, sandboxDoc, setRenderers, svgSize, watchRenderers } from "./diagrams";

// EDIT-029 / EDIT-030 (T-235-b): the parts around the drawing libraries, which are not installed yet.
const md = (s: string) => marked.parse(s, { async: false });

afterEach(() => setRenderers({ mermaid: undefined, math: undefined }));

describe("the locked diagram page", () => {
  it("allows no scripts: a policy that permits only inline styles and data pictures, and the svg alone", () => {
    const doc = sandboxDoc('<svg viewBox="0 0 10 10"></svg>');
    expect(doc).toContain(`default-src 'none'`);
    expect(doc).toContain(`img-src data:`);
    expect(doc).not.toMatch(/<script/i);
    expect(doc).not.toMatch(/script-src/);
    expect(doc).toContain('<svg viewBox="0 0 10 10"></svg>');
  });

  it("sizes the frame from the svg's viewBox, else its width and height, else a default", () => {
    expect(svgSize('<svg viewBox="0 0 300 150" width="100%">')).toEqual({ w: 300, h: 150 });
    expect(svgSize('<svg width="200px" height="80">')).toEqual({ w: 200, h: 80 });
    expect(svgSize("<svg>")).toBeNull();
    expect(svgSize('<svg viewBox="0 0 0 0">')).toBeNull();
    expect(diagramFrame('<svg viewBox="0 0 400 100">')).toMatchObject({ ratio: "400 / 100", maxWidth: 400 });
    expect(diagramFrame("<svg>").ratio).toBe("16 / 9");
  });

  it("asks mermaid for strict mode, no HTML labels and a theme per background", () => {
    const dark = mermaidConfig(true);
    expect(dark.securityLevel).toBe("strict");
    expect(dark.startOnLoad).toBe(false);
    expect(dark.flowchart.htmlLabels).toBe(false);
    expect(dark.theme).toBe("dark");
    expect(dark.themeVariables.primaryTextColor).toBeTruthy();
    expect(mermaidConfig(false).theme).toBe("neutral");
    expect([dark.layout, dark.look]).toEqual(["dagre", "classic"]); // Mermaid 12 would default to ELK and the neo look
  });
});

describe("finding maths", () => {
  it("takes inline $x$ and $$ blocks out and leaves money, code spans and fences alone", () => {
    const src = ["It costs $5 and $10 today.", "Inline $a_b + c_d$ here and `$not$` there.", "", "$$", "\\int_0^1 x\\,dx", "$$", "", "```", "$$ in code $$", "$x$", "```", "$$e^{i\\pi}=-1$$", "Price \\$3 and \\$4"].join("\n");
    const { text, items } = extractMath(src);
    expect(items.map((i) => [i.tex, i.display])).toEqual([
      ["a_b + c_d", false],
      ["\\int_0^1 x\\,dx", true],
      ["e^{i\\pi}=-1", true],
    ]);
    expect(text).toContain("It costs $5 and $10 today.");
    expect(text).toContain("`$not$`");
    expect(text).toContain("$$ in code $$\n$x$");
    expect(text).toContain("Price \\$3 and \\$4");
    expect(text).not.toContain("int_0");
  });

  it("an unclosed $$ stays text", () => {
    const { items, text } = extractMath("start\n$$\nnever closed");
    expect(items).toEqual([]);
    expect(text).toBe("start\n$$\nnever closed");
  });
});

describe("putting maths back", () => {
  const render = (tex: string, display: boolean) => `<m d="${display ? 1 : 0}">${tex}</m>`;

  it("keeps TeX with underscores and stars intact through the markdown parser", () => {
    const src = "Inline $a_b * c_d$ and\n\n$$\nx_1 + y_2\n$$\n";
    expect(renderNote(src, md)).not.toContain("KXMATH"); // placeholders are always resolved
    const { text, items } = extractMath(src);
    const withRenderer = restoreMath(md(text), items, render);
    expect(withRenderer).toContain('<span class="md-math"><m d="0">a_b * c_d</m></span>');
    expect(withRenderer).toContain('<div class="md-math md-math-block"><m d="1">x_1 + y_2</m></div>');
    expect(withRenderer).not.toContain("<p><div"); // a block is not wrapped in a paragraph
    expect(withRenderer).not.toContain("<em>");
  });

  it("without a renderer, or when it throws on bad TeX, the author's text is shown as written", () => {
    expect(renderNote("see $a_b$ ok", md)).toContain('<code class="md-math-src">$a_b$</code>');
    expect(renderNote("$$\nx\n$$", md)).toContain('<pre class="md-math-src"><code>$$\nx\n$$</code></pre>');
    setRenderers({
      math: () => {
        throw new Error("bad tex");
      },
    });
    expect(renderNote("a $\\frac{$ b", md)).toContain("md-math-src");
    setRenderers({ math: (t) => `<i>${t}</i>` });
    expect(renderNote("a $x$ b", md)).toContain('<span class="md-math"><i>x</i></span>');
  });

  it("escapes the fallback so a hostile line cannot inject markup", () => {
    expect(renderNote("$<img src=x onerror=alert(1)>$", md)).not.toContain("<img");
  });
});

describe("plugging in the libraries", () => {
  it("setRenderers tells watchers and keeps what was set; loadRenderers is quiet when diagramLibs.ts does not exist", async () => {
    const seen = vi.fn();
    const off = watchRenderers(seen);
    const m = async () => "<svg></svg>";
    setRenderers({ mermaid: m });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(getRenderers().mermaid).toBe(m);
    off();
    setRenderers({ math: () => "" });
    expect(seen).toHaveBeenCalledTimes(1);
    await expect(loadRenderers()).resolves.toBeUndefined();
  });
});
