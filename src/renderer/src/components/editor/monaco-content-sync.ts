import type { editor } from 'monaco-editor'

export type MonacoContentSyncMode = 'undoable' | 'read-only-live-tail'

// Why: model.getEOL() is Monaco's platform default (CRLF on Windows) for a model whose content
// has no line break to detect a convention from. Derive the target EOL from the model's current
// value instead (already fetched by the caller): it matches getEOL() for any model with real
// multi-line content and only falls back to LF when there's genuinely nothing to detect from.
function resolveTargetEol(currentContent: string): '\n' | '\r\n' {
  return currentContent.includes('\r\n') ? '\r\n' : '\n'
}

// Why: getValue() always renders line breaks through the model's own stored EOL, regardless of
// which characters an edit inserted — so the platform-default mismatch above is invisible to
// callers unless the model itself is corrected to match.
function alignModelEol(model: editor.ITextModel, targetEol: '\n' | '\r\n'): void {
  if (model.getEOL() === targetEol) {
    return
  }
  model.setEOL(targetEol === '\n' ? 0 : 1) // editor.EndOfLineSequence.LF / .CRLF
}

function normalizeToModelEol(content: string, targetEol: '\n' | '\r\n'): string {
  if (targetEol === '\n' && !content.includes('\r')) {
    return content
  }
  return content.replace(/\r\n|\r|\n/g, targetEol)
}

function applyModelEdit(
  editorInstance: editor.IStandaloneCodeEditor,
  model: editor.ITextModel,
  edit: editor.IIdentifiedSingleEditOperation,
  mode: MonacoContentSyncMode,
  withUndoStops: boolean
): void {
  if (mode === 'read-only-live-tail') {
    // Why: live-tail updates are machine-owned and cannot be undone by users;
    // recording them would retain the growing log again in Monaco's undo service.
    model.applyEdits([edit])
    return
  }
  if (withUndoStops) {
    editorInstance.pushUndoStop()
  }
  model.pushEditOperations([], [edit], () => null)
  if (withUndoStops) {
    editorInstance.pushUndoStop()
  }
}

function replaceModelContent(
  editorInstance: editor.IStandaloneCodeEditor,
  model: editor.ITextModel,
  currentContent: string,
  content: string,
  mode: MonacoContentSyncMode,
  withUndoStops: boolean
): void {
  if (currentContent === content) {
    return
  }
  const fullRange = model.getFullModelRange()
  applyModelEdit(editorInstance, model, { range: fullRange, text: content }, mode, withUndoStops)
}

/**
 * Reconcile a freshly-mounted editor's retained model against the current
 * `content`. Used from handleMount.
 *
 * Why: `keepCurrentModel` retains Monaco models across unmounts so undo/redo
 * survives tab switches. But @monaco-editor/react skips its value→model sync
 * on the first render after a remount and reuses the retained model — so
 * external changes that arrived while the tab was unmounted are invisible
 * until we explicitly push them into the model here.
 */
export function syncContentOnMount(
  editorInstance: editor.IStandaloneCodeEditor,
  content: string,
  mode: MonacoContentSyncMode = 'undoable'
): boolean {
  const model = editorInstance.getModel()
  if (!model) {
    return false
  }
  const currentContent = model.getValue()
  const targetEol = resolveTargetEol(currentContent)
  alignModelEol(model, targetEol)
  const normalizedContent = normalizeToModelEol(content, targetEol)
  if (currentContent === normalizedContent) {
    return false
  }
  // Why: no undo stop on mount — the retained model's text was already the
  // user's last-known state, and adding an undo entry here would make Cmd+Z
  // revert to the pre-remount text, which is confusing.
  replaceModelContent(editorInstance, model, currentContent, normalizedContent, mode, false)
  return true
}

/**
 * Push a prop-driven content change into the live model. Used from a
 * useEffect that runs whenever `content` changes.
 *
 * Why: handles the live-mount update path — external file changes that
 * arrive while the editor stays mounted. The emitted-content short-circuit
 * is done at the call site before invoking this.
 */
export function syncContentUpdate(
  editorInstance: editor.IStandaloneCodeEditor,
  content: string,
  mode: MonacoContentSyncMode = 'undoable'
): void {
  const model = editorInstance.getModel()
  if (!model) {
    return
  }
  const currentContent = model.getValue()
  const targetEol = resolveTargetEol(currentContent)
  alignModelEol(model, targetEol)
  const normalizedContent = normalizeToModelEol(content, targetEol)
  if (currentContent.length === normalizedContent.length) {
    replaceModelContent(editorInstance, model, currentContent, normalizedContent, mode, true)
    return
  }
  if (
    normalizedContent.length > currentContent.length &&
    normalizedContent.startsWith(currentContent)
  ) {
    // Why: preserving the existing prefix lets Monaco retain viewport,
    // selection, find-widget, and tokenization state above a live-file append.
    const fullRange = model.getFullModelRange()
    applyModelEdit(
      editorInstance,
      model,
      {
        range: {
          startLineNumber: fullRange.endLineNumber,
          startColumn: fullRange.endColumn,
          endLineNumber: fullRange.endLineNumber,
          endColumn: fullRange.endColumn
        },
        text: normalizedContent.slice(currentContent.length)
      },
      mode,
      true
    )
    return
  }
  replaceModelContent(editorInstance, model, currentContent, normalizedContent, mode, true)
}
