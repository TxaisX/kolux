/**
 * Pure autosave state machine for the handoff editor: edits mark the buffer dirty, a blur or an
 * idle timeout flushes a dirty buffer to a save, and the save's outcome lands on 'saved' or
 * 'error'. No timers or IPC here — the panel owns scheduling the idle flush and calling the
 * store; this only decides what state that produces.
 */
export type HandoffAutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export type HandoffAutosaveState = {
  status: HandoffAutosaveStatus
  /** Current editor buffer. */
  text: string
  /** Text as of the last successful save (or load). */
  savedText: string
}

export type HandoffAutosaveEvent =
  | { type: 'loaded'; text: string }
  | { type: 'edit'; text: string }
  | { type: 'flush' }
  | { type: 'save-succeeded'; text: string }
  | { type: 'save-failed' }

export function createHandoffAutosaveState(text = ''): HandoffAutosaveState {
  return { status: 'idle', text, savedText: text }
}

/** True once a 'flush' event should trigger the actual save call. */
export function shouldFlushHandoffAutosave(
  state: HandoffAutosaveState,
  event: HandoffAutosaveEvent
): boolean {
  return event.type === 'flush' && state.status === 'dirty'
}

export function reduceHandoffAutosave(
  state: HandoffAutosaveState,
  event: HandoffAutosaveEvent
): HandoffAutosaveState {
  switch (event.type) {
    case 'loaded':
      return { status: 'idle', text: event.text, savedText: event.text }
    case 'edit':
      return {
        ...state,
        text: event.text,
        status: event.text === state.savedText ? 'idle' : 'dirty'
      }
    case 'flush':
      return state.status === 'dirty' ? { ...state, status: 'saving' } : state
    case 'save-succeeded':
      // Why: text may have changed again while the save was in flight — only clear
      // dirty-ness if nothing has moved past what this save actually persisted.
      return {
        status: state.text === event.text ? 'saved' : 'dirty',
        text: state.text,
        savedText: event.text
      }
    case 'save-failed':
      return { ...state, status: 'error' }
  }
}
