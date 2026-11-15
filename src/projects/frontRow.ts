// Audit F23-F25, F30: the project in front, read from the page. Since one grid per project (2026-11-13) the
// sidebar's visible row for it is the project header (`.proj.folder`, marked `.sel` while its grid shows), and the
// old worktree rows (`.sess`, `button.branch`) are hidden. `.sess` also matches pending rows and the Agents rail,
// so readers ask here instead of using a `.sess` selector.

/** The visible header of the project whose grid is in front. */
export const FRONT_PROJECT_ROW = ".sidebar .proj.folder.sel[data-path]";

/** That header, or null when no project is in front. */
export const frontProjectRow = (doc: Pick<Document, "querySelector"> = document): HTMLElement | null => doc.querySelector<HTMLElement>(FRONT_PROJECT_ROW);

/** The folder of the project in front (its main checkout), or null. */
export const frontProjectPath = (doc: Pick<Document, "querySelector"> = document): string | null => frontProjectRow(doc)?.dataset.path ?? null;
