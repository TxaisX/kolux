// PROJ-060: a workspace's details form: the shown name, a linked GitHub issue or pull request, and
// a comment that the card shows as compact formatted text. Pure, so the rules are tested alone.
import { workItem } from "./model";

export type Details = { name: string | null; item: string | null; comment: string };

/** What pasting into the linked-item field fills in: the address of a GitHub issue or pull request, else the text as typed. */
export function itemFromPaste(pasted: string): string {
  const w = workItem(pasted);
  return w ? `https://${w.host}/${w.owner}/${w.repo}/${w.kind === "pull" ? "pull" : "issues"}/${w.number}` : pasted.trim();
}


export type Span = { t: "text"; text: string } | { t: "link"; text: string; href: string } | { t: "image"; alt: string; href: string };
export type Block = { kind: "heading"; level: number; spans: Span[] } | { kind: "para"; spans: Span[] };

/** Only web addresses are ever opened from a comment. */
export const safeHref = (href: string): string | null => {
  const h = href.trim();
  return /^https?:\/\/[^\s<>"]+$/i.test(h) ? h : null;
};

const INLINE = /(!?)\[([^\]\n]*)\]\(([^)\s]*)\)/g;

/** One line cut into text, links and images; an address that is not http(s) stays as plain text. */
export function inline(line: string): Span[] {
  const out: Span[] = [];
  let at = 0;
  for (const m of line.matchAll(INLINE)) {
    const href = safeHref(m[3]);
    const start = m.index ?? 0;
    if (!href) continue;
    if (start > at) out.push({ t: "text", text: line.slice(at, start) });
    out.push(m[1] ? { t: "image", alt: m[2] || "image", href } : { t: "link", text: m[2] || href, href });
    at = start + m[0].length;
  }
  if (at < line.length) out.push({ t: "text", text: line.slice(at) });
  return out;
}

/** The comment as compact blocks: headings (any `#` depth, kept as a level), then one paragraph per run of lines. Blank lines separate. */
export function commentBlocks(comment: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "para", spans: inline(para.join(" ")) });
    para = [];
  };
  for (const raw of comment.split(/\r?\n/)) {
    const line = raw.trim();
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: "heading", level: h[1].length, spans: inline(h[2]) });
    } else if (line === "") flush();
    else para.push(line);
  }
  flush();
  return blocks;
}
