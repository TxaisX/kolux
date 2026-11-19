// GIT-050: draws markdown.ts's blocks as React elements (never HTML strings).
import type { ReactNode } from "react";
import { type Block, parseMarkdown, type Span } from "./markdown";

function spans(list: Span[]): ReactNode[] {
  return list.map((s, i) => {
    if (s.t === "code") return <code key={i}>{s.text}</code>;
    if (s.t === "bold") return <strong key={i}>{s.text}</strong>;
    if (s.t === "italic") return <em key={i}>{s.text}</em>;
    if (s.t === "link")
      return (
        <a key={i} href={s.href} title={s.href} target="_blank" rel="noreferrer">
          {s.text}
        </a>
      );
    return s.text;
  });
}

function block(b: Block, i: number): ReactNode {
  if (b.t === "heading") return <p key={i} className={`md-h md-h${Math.min(b.level, 4)}`}>{spans(b.spans)}</p>;
  if (b.t === "code") return <pre key={i} className="md-code">{b.text}</pre>;
  if (b.t === "quote") return <blockquote key={i}>{spans(b.spans)}</blockquote>;
  if (b.t === "list") {
    const items = b.items.map((it, j) => <li key={j}>{spans(it)}</li>);
    return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
  }
  return <p key={i}>{spans(b.spans)}</p>;
}

export default function Markdown({ text }: { text: string }) {
  return <div className="md">{parseMarkdown(text).map(block)}</div>;
}
