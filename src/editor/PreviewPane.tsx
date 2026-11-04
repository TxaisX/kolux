// A markdown preview tab (EDIT-012, Mod+Shift+V): the file rendered read-only, with "Preview" in
// its header. It follows the open text of the file live when an editor has it, else the disk copy.
// The HTML is sanitised (DOMPurify, with what could restyle, cover or reload the window left out) and
// clicks do nothing on their own, so nothing in a note can take over the app's window.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Marked } from "marked";
import DOMPurify from "dompurify";
import { Close, Dots, FileCode, List } from "../chrome/icons";
import { baseName, subscribe, textOf } from "./buffers";
import { domPick, selections } from "./notes";
import { Contents, FindBar, selectedIn, type FindOpen } from "./NoteTools";
import { outline } from "./toc";
import { hideFrontFor, splitFront } from "./frontMatter";
import { FrontMatterBlock } from "../shell/MdViewControls";
import { frontControl } from "../shell/mdView";
import { mdPrefs, setMdPrefs } from "../shell/mdPrefs";
import { useMenuKeys } from "./menuNav";
import { followClick, inertClick, type LinkHandler } from "./linkClicks";
import { drawDiagrams, esc, loadRenderers, renderNote, watchRenderers } from "./diagrams";
import { filterDataPictures } from "./notePictures";
import { showPicturesIn } from "./pictureDom";
import { readPicture } from "./pictureBytes";
import { mimeOf } from "./imageFiles";
import { bytesToDataUri, exportNotePdf, noteTitle } from "../browser/notePdf";
import { useKeymap } from "../keys/KeymapContext";
import { withChord } from "../terminal/PaneMenu";
import { labelOf, matchEvent } from "../keys/keymap";
import "./editor-extras.css";

type Props = { id: number; path: string; hidden?: boolean; focused?: boolean; onFocus?: () => void; onClose?: () => void; worktree?: string | null; onLink?: LinkHandler };

// T-601: the preview sits in the app's own page, so a note keeps its own HTML except what could restyle, cover, hide
// or reload the whole window: style sheets and style attributes, forms and their fields, image maps, dialogs, popovers,
// hidden text and its own class names (sanitizeNote). styles.css also contains paint on the preview, so nothing fixed
// inside a note reaches outside its pane.
const NOTE_HTML = {
  FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "dialog", "map", "area"],
  FORBID_ATTR: ["hidden", "style", "popover", "popovertarget", "command", "commandfor"],
};
// T-601 review round 1: the app's own class names include full-window ones (.scrim, .ask-backdrop, .menu-backdrop are
// position: fixed; inset: 0), so a note keeps none of its own classes except a code block's language-* (which marks a
// diagram's code and names the language). The renderer's own class added before sanitising (md-task, the task boxes below)
// is kept too; md-math* and md-diagram* are added after it (restoreMath, drawDiagrams) and never pass through here.
const RENDERER_CLASSES = new Set(["md-task"]);
/** The class names a note may keep (T-601): language-* and the renderer's own. */
export const noteClasses = (value: string): string =>
  value
    .split(/\s+/)
    .filter((c) => /^language-[\w#+.-]+$/.test(c) || RENDERER_CLASSES.has(c))
    .join(" ");
/** DOMPurify's uponSanitizeAttribute hook for a note: a class attribute keeps only noteClasses, or goes. */
export const noteClassHook = (_node: Element, data: { attrName: string; attrValue: string; keepAttr: boolean }) => {
  if (data.attrName !== "class") return;
  const kept = noteClasses(data.attrValue);
  if (kept) data.attrValue = kept;
  else data.keepAttr = false;
};
/** Sanitises a note's HTML with NOTE_HTML and the class hook; the hook is on only for this call, so DOMPurify's other users
 *  (katex in diagramLibs.ts, cleanSvg in diagrams.ts, agent text) keep their classes. */
function sanitizeNote(html: string): string {
  DOMPurify.addHook("uponSanitizeAttribute", noteClassHook);
  try {
    return DOMPurify.sanitize(html, NOTE_HTML);
  } finally {
    DOMPurify.removeHook("uponSanitizeAttribute", noteClassHook);
  }
}
// marked draws a task list's boxes as form fields, which a note may not hold, so a note's boxes are drawn as text.
const noteMd = new Marked({ renderer: { checkbox: ({ checked }) => `<span class="md-task">${checked ? "☑" : "☐"}</span> ` } });
// Agent text keeps marked's boxes and shows any HTML it holds as text.
const agentMd = new Marked({ renderer: { html: ({ text }) => esc(text) } });

/** Markdown to HTML for the app's own page. A note (`note`, the preview) keeps its own HTML within NOTE_HTML; anything
 * else, such as an agent's plan or to-do list (PlanSheet, chat StepRows), shows its HTML as text (T-601).
 * EDIT-009: an inline data picture over the size limit, not a picture type or damaged is left out (notePictures.ts). */
export const renderMarkdown = (md: string, note = false) =>
  filterDataPictures(note ? sanitizeNote(noteMd.parse(md, { async: false })) : DOMPurify.sanitize(agentMd.parse(md, { async: false })));

export default function PreviewPane({ id, path, hidden = false, focused = false, onFocus, onClose, worktree = null, onLink }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  // EDIT-017 / EDIT-016: the find bar and the contents panel.
  const [find, setFind] = useState<FindOpen | null>(null);
  const [toc, setToc] = useState(false);
  // EDIT-018: the actions menu and the line saying how the PDF export went.
  const [menu, setMenu] = useState(false);
  const { box: menuBox, remember } = useMenuKeys(menu, () => setMenu(false));
  const exporting = useRef(false); // a second Export while one runs would print the note twice
  const [pdfLine, setPdfLine] = useState<string | null>(null);
  const page = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const root = useCallback(() => page.current, []);
  const keymap = useKeymap();
  // EDIT-029 / EDIT-030: diagrams and maths draw once the libraries are plugged in (diagrams.ts).
  const [libs, setLibs] = useState(0);
  useEffect(() => {
    void loadRenderers();
    return watchRenderers(() => setLibs((n) => n + 1));
  }, []);
  // EDIT-019 (row 94): front matter is its own block above the note, shown at first and remembered per file (VIEW-113); the page below is the body.
  const { front, body } = useMemo(() => splitFront(text ?? ""), [text]);
  // The choice is held with its path and saved on the click, so a pane moved to another file reads that file's own choice.
  const [held, setHeld] = useState({ path, hide: false });
  const hideFront = hideFrontFor(held, path, (p) => mdPrefs(p).hideFront);
  const toggleFront = () => {
    setHeld({ path, hide: !hideFront });
    setMdPrefs(path, { hideFront: !hideFront });
  };
  const frontCtl = frontControl(front, hideFront);
  const html = useMemo(() => (text === null ? "" : renderNote(body, (md) => renderMarkdown(md, true))), [text, body, libs]);
  useEffect(() => {
    let alive = true;
    if (page.current) void drawDiagrams(page.current, true, () => alive);
    return () => {
      alive = false;
    };
  }, [html]);
  // EDIT-009: the note's own pictures (beside it on disk) are read through the file fence and shown as they scroll in.
  useEffect(() => (page.current ? showPicturesIn(page.current, path) : undefined), [html, path]);
  const hasHeadings = useMemo(() => outline(body).length > 0, [body]);

  useEffect(() => {
    let alive = true;
    setError(null);
    const open = textOf(path);
    if (open !== null) setText(open);
    else
      invoke<string>("file_read", { path }).then(
        (t) => alive && setText(t),
        (err) => alive && setError(String(err)),
      );
    const off = subscribe(path, () => {
      const t = textOf(path);
      if (t !== null) setText(t);
    });
    return () => {
      alive = false;
      off();
    };
  }, [path, tries]);

  // GIT-042: the add-note shortcut reads the selection in the rendered page.
  useEffect(() => {
    selections.set(id, () => domPick(document.querySelector(`.pane.preview[data-key="${id}"] .md-preview`), path, text ?? ""));
    return () => void selections.delete(id);
  }, [id, path, text]);

  // A preview opened from the explorer or Quick Open takes the keyboard, so Mod+F answers at once.
  useEffect(() => {
    if (focused && !hidden && !section.current?.contains(document.activeElement)) section.current?.focus();
  }, [focused, hidden]);

  // The user's own find chords (editor.find and editor.replace both open find: a preview has
  // nothing to replace).
  const onKeys = (e: React.KeyboardEvent) => {
    const hit = matchEvent(keymap, e.nativeEvent, ["editor"]);
    if (hit?.id !== "editor.find" && hit?.id !== "editor.replace") return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) setFind((f) => ({ replace: false, seed: selectedIn(page.current), n: (f?.n ?? 0) + 1 }));
  };

  // EDIT-018: the rendered note, its on-disk pictures read in as data addresses, printed to a PDF by a hidden page (browser_pdf.rs).
  const exportPdf = async () => {
    setMenu(false);
    const shown = page.current;
    if (!shown || exporting.current) return;
    exporting.current = true;
    setPdfLine("Exporting to PDF...");
    try {
      const copy = shown.cloneNode(true) as HTMLElement;
      for (const img of Array.from(copy.querySelectorAll<HTMLImageElement>("img[data-local-picture]"))) {
        const file = img.getAttribute("data-local-picture") ?? "";
        try {
          img.setAttribute("src", bytesToDataUri(await readPicture(file, invoke), mimeOf(file)));
        } catch {
          img.removeAttribute("src");
        }
      }
      const done = await exportNotePdf(invoke, { html: copy.innerHTML, title: noteTitle(path), folder: path.replace(/[\\/][^\\/]*$/, "") });
      setPdfLine(done.kind === "saved" ? `Saved ${done.path}` : null);
    } catch (err) {
      setPdfLine(`PDF export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      exporting.current = false;
    }
  };

  const name = baseName(path);
  return (
    <section ref={section} className={`pane editor preview${focused ? " focused" : ""}${toc && hasHeadings ? " toc-open" : ""}`} hidden={hidden} aria-label={`Preview of ${name}`} onMouseDown={onFocus} onKeyDownCapture={onKeys} data-kind="preview" data-key={id} tabIndex={-1}>
      <header className="pane-head">
        <span className="agent-mark" title="Markdown preview">
          <FileCode size={13} />
        </span>
        <span className="title">{name}</span>
        <span className="preview-tag">Preview</span>
        <span className="path" title={path}>
          {path}
        </span>
        {frontCtl && (
          <button className="ib" aria-pressed={frontCtl.pressed} title={frontCtl.label} aria-label={frontCtl.label} onClick={toggleFront}>
            Front
          </button>
        )}
        {hasHeadings && (
          <button className="ib" aria-pressed={toc} title="Contents" aria-label="Contents" onClick={() => setToc((v) => !v)}>
            <List size={13} />
          </button>
        )}
        <span className="right">
          <span className="diff-actions">
            <button className="ib" aria-haspopup="menu" aria-expanded={menu}
              onClick={(e) => {
                remember(e.currentTarget); // before the menu opens: its first row takes focus at once
                setMenu((m) => !m);
              }}
              title="Note actions" aria-label="Note actions">
              <Dots size={12} />
            </button>
            {menu && (
              <>
                <div className="menu-backdrop" onMouseDown={() => setMenu(false)} />
                <div ref={menuBox} className="menu diff-menu" role="menu" aria-label="Note actions">
                  <button role="menuitem" className="menu-item" onClick={() => void exportPdf()}>
                    <span className="name">Export to PDF...</span>
                  </button>
                </div>
              </>
            )}
          </span>
          <button className="ib" onClick={onClose} title={withChord("Close tab", labelOf(keymap, "tab.close"))} aria-label="Close tab">
            <Close size={12} />
          </button>
        </span>
      </header>
      {error && (
        <div className="notice load-failed" role="alert">
          {name} did not open: {error}
          <button className="btn" onClick={() => setTries((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}
      {pdfLine && (
        <div className="notice" role="status">
          {pdfLine}
          <button className="btn" onClick={() => setPdfLine(null)}>
            Dismiss
          </button>
        </div>
      )}
      {find && <FindBar pane={id} root={root} open={find} onClose={() => (setFind(null), section.current?.focus())} />}
      {toc && hasHeadings && <Contents md={body} path={path} root={root} onClose={() => setToc(false)} />}
      <FrontMatterBlock front={front} hide={hideFront} />
      <div
        ref={page}
        className="pane-body md-preview"
        aria-readonly="true"
        onClick={(e) => {
          // EDIT-014: Mod+click follows a link; a plain click never navigates (T-601: nor does anything else in the page act on it).
          if (!followClick(e.nativeEvent, e.currentTarget, path, worktree, onLink)) inertClick(e.nativeEvent);
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </section>
  );
}
