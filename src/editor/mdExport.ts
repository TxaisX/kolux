// The markdown the rich view writes back. Lexical 0.53's export escapes `[`, `]`, `<` and `&` in plain
// text as `&#91;`-style entities; a note keeps the characters the user typed (EDIT-019: raw HTML and
// brackets come back byte for byte), so they are undone here. One place, so the editor, the round-trip
// check and a <details> body all write the same text. The cost: a note that literally holds `&#60;`
// saves `<`; every other entity (`&#13;`, `&#38;` inside a URL's title) is left alone.
import { $convertToMarkdownString, type Transformer } from "@lexical/markdown";
import type { ElementNode } from "lexical";

const UNDO: Record<string, string> = { "60": "<", "91": "[", "93": "]", "38": "&" };

/** Lexical's text escapes turned back into the characters they stand for. */
export const unescapeText = (md: string): string => md.replace(/&#(60|91|93|38);/g, (whole, d: string) => UNDO[d] ?? whole);

/** The markdown for the whole editor, or for `node` alone, with the text escapes undone. */
export const $exportMarkdown = (all: Transformer[], node?: ElementNode): string => unescapeText($convertToMarkdownString(all, node));
