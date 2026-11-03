// EDIT-037: the explorer's Search view. It searches the worktree's file contents as you type
// (plain text and ignoring case unless asked), lists the hits grouped by file, and opens a file
// at the hit when one is clicked.
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "../chrome/icons";
import { joinPath, revealAt, searchSession, summary, type Found } from "./search";
import "./editor-extras.css";

// It stays mounted while the tree is shown, so going back to it keeps the search and its results.
type Props = { root: string; hidden: boolean; focusAsk: number; onOpen: (path: string) => void; /** EDIT-038: the text to search for, set each time a search is started from an editor. */ seed?: { text: string; at: number }; /** EDIT-035: "Find in folder" limits the search to one folder through the include pattern. */ scope?: { glob: string; at: number }; /** Escape in the search hands the view back to the file tree. */ onClose?: () => void };

// The panel is narrow, so only the words just before a hit are shown and the hit stays in sight.
const LEAD = 20;
const lead = (s: string) => (s.length > LEAD ? "…" + s.slice(-LEAD) : s);

export default function ContentSearch({ root, hidden, focusAsk, onOpen, seed, scope, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  useEffect(() => {
    if (scope) setInclude(scope.glob);
  }, [scope?.at]);
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shut, setShut] = useState<Set<string>>(new Set());
  const input = useRef<HTMLInputElement>(null);
  const session = useRef<ReturnType<typeof searchSession> | null>(null);

  // FIX-4: one session per view and folder. Closing the view (a workspace switch remounts it) stops
  // the folder's search that is still running.
  useEffect(() => {
    const s = searchSession(root);
    session.current = s;
    return () => s.close();
  }, [root]);

  useEffect(() => {
    if (seed) setQuery(seed.text);
  }, [seed?.at]);

  useEffect(() => {
    if (!focusAsk || hidden) return;
    input.current?.focus();
    input.current?.select();
  }, [focusAsk, hidden]);

  // Typing searches after a short pause; a slower earlier answer never replaces a newer one.
  useEffect(() => {
    const s = session.current;
    if (!s) return;
    if (!query) {
      s.empty();
      setFound(null);
      setError(null);
      setBusy(false);
      return;
    }
    s.drop();
    const t = window.setTimeout(() => {
      setBusy(true);
      s.run(
        { query, matchCase, wholeWord, regex, include, exclude },
        (f) => (setFound(f), setError(null), setBusy(false), setShut(new Set())),
        (e) => (setFound(null), setError(String(e)), setBusy(false)),
      );
    }, 250);
    return () => clearTimeout(t);
  }, [root, query, matchCase, wholeWord, regex, include, exclude]);

  const toggle = (on: boolean, set: (v: boolean) => void, label: string, text: string) => (
    <button className={`ib${on ? " on" : ""}`} aria-pressed={on} title={label} aria-label={label} onClick={() => set(!on)}>
      {text}
    </button>
  );

  return (
    <div className="content-search" hidden={hidden} role="search" aria-label="Search file contents" onKeyDown={(e) => e.key === "Escape" && onClose && (e.preventDefault(), e.stopPropagation(), onClose())}>
      <div className="cs-row">
        <input ref={input} value={query} placeholder="Search" aria-label="Search text" spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
        {toggle(matchCase, setMatchCase, "Match case", "Aa")}
        {toggle(wholeWord, setWholeWord, "Whole word", "ab")}
        {toggle(regex, setRegex, "Regular expression", ".*")}
      </div>
      <input className="cs-glob" value={include} placeholder="Files to include, e.g. *.ts, src/**" aria-label="Files to include" spellCheck={false} onChange={(e) => setInclude(e.target.value)} />
      <input className="cs-glob" value={exclude} placeholder="Files to exclude" aria-label="Files to exclude" spellCheck={false} onChange={(e) => setExclude(e.target.value)} />
      {error ? (
        <div className="cs-status bad" role="alert">
          The search failed: {error}
        </div>
      ) : (
        query && <div className="cs-status" role="status">{busy ? "Searching…" : found ? summary(found) : ""}</div>
      )}
      <div className="cs-results">
        {found?.files.map((f) => {
          const open = !shut.has(f.path);
          const flip = () => setShut((s) => (s.delete(f.path) ? new Set(s) : new Set(s).add(f.path)));
          return (
            <div key={f.path} className="cs-file">
              <button className="cs-name" onClick={flip} aria-expanded={open} title={f.path}>
                <ChevronDown size={10} style={open ? undefined : { transform: "rotate(-90deg)" }} />
                <span className="cs-path">{f.path}</span>
                <span className="cs-count">{f.hits.length}</span>
              </button>
              {open &&
                f.hits.map((h, i) => (
                  <button
                    key={i}
                    className="cs-hit"
                    title={`Line ${h.line}`}
                    onClick={() => {
                      const path = joinPath(root, f.path);
                      onOpen(path);
                      revealAt(path, { line: h.line, col: h.col, len: h.len });
                    }}
                  >
                    <span className="cs-line">{h.line}</span>
                    <span className="cs-text">
                      {lead(h.before)}
                      <mark>{h.text}</mark>
                      {h.after}
                    </span>
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
