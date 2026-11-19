// Markdown to HTML for the app's own page (an agent's plan or to-do list in the chat and the plan sheet).
// The HTML is sanitised (DOMPurify, with what could restyle, cover or reload the window left out) so nothing in a note
// or an agent's text can take over the app's window.
import { Marked } from "marked";
import DOMPurify from "dompurify";
import { filterDataPictures } from "./notePictures";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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
