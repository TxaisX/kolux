// EDIT-024 (T-316-b): the cells view of a Jupyter notebook tab. It follows the tab's open text, shows each cell as a
// text box (code or markdown), with saved outputs under code cells as plain text, and writes every change back as
// the notebook's JSON through `onText`, so the source view, undo and Save all see it. A very long cell shows only its
// start until asked. Opening a notebook never runs it: a code cell's Run button asks once whether the notebook is trusted, and
// Rust does the run (notebook_run.rs), so the page cannot run an untrusted notebook either (see notebookRun.ts).
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Ask from "../chrome/Ask";
import { subscribe, textOf } from "./buffers";
import { runCell, TRUST_BODY, TRUST_TITLE } from "./notebookRun";
import { insertCell, kindOf, limited, moveCell, outputText, parseNotebook, removeCell, serialize, setKind, sourceOf, withSource, type CellKind, type Notebook } from "./notebook";

type Props = { path: string; loaded: number; hidden?: boolean; readOnly?: boolean; onText: (text: string) => void };

const OUTPUT_LINES = 60;
const KINDS: CellKind[] = ["code", "markdown", "raw"];

function CellBox({ text, kind, readOnly, onEdit }: { text: string; kind: CellKind; readOnly: boolean; onEdit: (t: string) => void }) {
  const [full, setFull] = useState(false);
  const [draft, setDraft] = useState(text);
  const timer = useRef<number | undefined>(undefined);
  const sent = useRef(text);
  const edit = useRef(onEdit); // the timer fires later: it must call the latest handler, not the one from when the key was typed
  edit.current = onEdit;
  useEffect(() => {
    if (text !== sent.current) {
      sent.current = text;
      setDraft(text);
    }
  }, [text]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const send = (t: string) => {
    window.clearTimeout(timer.current);
    if (t !== sent.current) {
      sent.current = t;
      edit.current(t);
    }
  };
  const part = useMemo(() => limited(text), [text]);
  if (part.cut && !full) {
    return (
      <div className="nb-long">
        <pre className="nb-src">{part.shown}</pre>
        <button type="button" onClick={() => setFull(true)}>
          Show all {part.lines} lines
        </button>
      </div>
    );
  }
  return (
    <textarea
      className={`nb-src nb-${kind}`}
      value={draft}
      readOnly={readOnly}
      spellCheck={kind === "markdown"}
      rows={Math.min(30, Math.max(2, draft.split("\n").length))}
      onChange={(e) => {
        setDraft(e.target.value);
        window.clearTimeout(timer.current);
        const t = e.target.value;
        timer.current = window.setTimeout(() => send(t), 300);
      }}
      onBlur={(e) => send(e.target.value)}
    />
  );
}

export default function NotebookView({ path, loaded, hidden = false, readOnly = false, onText }: Props) {
  const [text, setText] = useState(() => textOf(path) ?? "");
  const [asking, setAsking] = useState<((yes: boolean) => void) | null>(null);
  const [running, setRunning] = useState<number | null>(null);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    const read = () => setText(textOf(path) ?? "");
    read();
    return subscribe(path, read);
  }, [path, loaded]);
  const parsed = useMemo(() => (hidden ? null : parseNotebook(text)), [text, hidden]);
  if (!parsed) return null;
  const label = `${path.split(/[\\/]/).pop()}, notebook cells`;
  if (!parsed.ok) {
    return (
      <div className="pane-body nb-view" role="region" aria-label={label}>
        <p className="csv-note">{parsed.why}</p>
      </div>
    );
  }
  const nb = parsed.nb;
  const change = (next: Notebook) => next !== nb && onText(serialize(next));
  const run = async (i: number) => {
    if (running !== null) return;
    setProblem("");
    setRunning(i);
    try {
      await runCell(path, nb, i, {
        invoke,
        ask: () => new Promise<boolean>((yes) => setAsking(() => yes)),
        onText,
        // the save the editor's own Save does; the editor's module loads on first use because EditorPane imports this view
        save: async () => (await import("./EditorPane")).saveQuiet(path, setProblem),
        current: () => {
          const now = parseNotebook(textOf(path) ?? "");
          return now.ok ? now.nb : null;
        },
      });
    } catch (e) {
      setProblem(String(e instanceof Error ? e.message : e));
    } finally {
      setRunning(null);
    }
  };
  const addRow = (at: number) =>
    readOnly ? null : (
      <div className="nb-add">
        {KINDS.map((k) => (
          <button key={k} type="button" onClick={() => change(insertCell(nb, at, k))}>
            + {k === "code" ? "Code" : k === "markdown" ? "Markdown" : "Raw"}
          </button>
        ))}
      </div>
    );
  return (
    <div className="pane-body nb-view" role="region" aria-label={label}>
      <p className="csv-note">
        {nb.cells.length === 1 ? "1 cell" : `${nb.cells.length} cells`}; saved outputs are kept. A code cell runs in a fresh Python each time, after you trust the notebook.
      </p>
      {problem && (
        <p className="csv-note" role="alert">
          {problem}
        </p>
      )}
      {asking && (
        <Ask
          title={TRUST_TITLE}
          body={TRUST_BODY}
          confirm="Trust and run"
          onConfirm={() => {
            asking(true);
            setAsking(null);
          }}
          onCancel={() => {
            asking(false);
            setAsking(null);
          }}
        />
      )}
      <div className="csv-scroll nb-cells">
        {addRow(0)}
        {nb.cells.map((c, i) => {
          const out = kindOf(c) === "code" ? limited(outputText(c), OUTPUT_LINES, 5000) : null;
          return (
            // a cell's id (format 4.5) is stable across moves; older notebooks fall back to the position
            <section key={typeof c.id === "string" ? c.id : `i${i}`} className={`nb-cell nb-k-${kindOf(c)}`} aria-label={`Cell ${i + 1}, ${kindOf(c)}`}>
              <header>
                <select value={kindOf(c)} disabled={readOnly} aria-label={`Cell ${i + 1} type`} onChange={(e) => change(setKind(nb, i, e.target.value as CellKind))}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                {kindOf(c) === "code" && typeof c.execution_count === "number" && <span className="nb-n">[{c.execution_count}]</span>}
                {!readOnly && c.cell_type === "code" && (
                  <button type="button" disabled={running !== null} aria-label={`Run cell ${i + 1}`} onClick={() => void run(i)}>
                    {running === i ? "Running..." : "Run"}
                  </button>
                )}
                {!readOnly && (
                  <span className="nb-tools">
                    <button type="button" disabled={i === 0} aria-label={`Move cell ${i + 1} up`} onClick={() => change(moveCell(nb, i, -1))}>
                      Up
                    </button>
                    <button type="button" disabled={i === nb.cells.length - 1} aria-label={`Move cell ${i + 1} down`} onClick={() => change(moveCell(nb, i, 1))}>
                      Down
                    </button>
                    <button type="button" aria-label={`Remove cell ${i + 1}`} onClick={() => change(removeCell(nb, i))}>
                      Remove
                    </button>
                  </span>
                )}
              </header>
              <CellBox text={sourceOf(c)} kind={kindOf(c)} readOnly={readOnly} onEdit={(t) => change(withSource(nb, i, t))} />
              {out && out.shown && (
                <pre className="nb-out" aria-label={`Cell ${i + 1} output`}>
                  {out.shown}
                  {out.cut && "\n... (more output is kept in the file)"}
                </pre>
              )}
              {addRow(i + 1)}
            </section>
          );
        })}
      </div>
    </div>
  );
}
