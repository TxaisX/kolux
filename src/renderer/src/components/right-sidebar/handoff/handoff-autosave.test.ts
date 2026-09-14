import { describe, expect, it } from 'vitest'
import {
  createHandoffAutosaveState,
  reduceHandoffAutosave,
  shouldFlushHandoffAutosave
} from './handoff-autosave'

describe('reduceHandoffAutosave', () => {
  it('loading seeds both text and savedText as idle', () => {
    const state = reduceHandoffAutosave(createHandoffAutosaveState(), {
      type: 'loaded',
      text: 'hello'
    })
    expect(state).toEqual({ status: 'idle', text: 'hello', savedText: 'hello' })
  })

  it('editing to a new value marks the buffer dirty', () => {
    const loaded = createHandoffAutosaveState('hello')
    const state = reduceHandoffAutosave(loaded, { type: 'edit', text: 'hello world' })
    expect(state.status).toBe('dirty')
    expect(state.text).toBe('hello world')
  })

  it('editing back to the saved value returns to idle', () => {
    const dirty = reduceHandoffAutosave(createHandoffAutosaveState('hello'), {
      type: 'edit',
      text: 'hello world'
    })
    const backToSaved = reduceHandoffAutosave(dirty, { type: 'edit', text: 'hello' })
    expect(backToSaved.status).toBe('idle')
  })

  it('flush moves a dirty buffer to saving', () => {
    const dirty = reduceHandoffAutosave(createHandoffAutosaveState('hello'), {
      type: 'edit',
      text: 'hello world'
    })
    const saving = reduceHandoffAutosave(dirty, { type: 'flush' })
    expect(saving.status).toBe('saving')
  })

  it('flush on an idle buffer is a no-op', () => {
    const idle = createHandoffAutosaveState('hello')
    expect(reduceHandoffAutosave(idle, { type: 'flush' })).toEqual(idle)
  })

  it('shouldFlushHandoffAutosave is true only for a flush on a dirty buffer', () => {
    const idle = createHandoffAutosaveState('hello')
    const dirty = reduceHandoffAutosave(idle, { type: 'edit', text: 'hello world' })
    expect(shouldFlushHandoffAutosave(idle, { type: 'flush' })).toBe(false)
    expect(shouldFlushHandoffAutosave(dirty, { type: 'flush' })).toBe(true)
    expect(shouldFlushHandoffAutosave(dirty, { type: 'edit', text: 'x' })).toBe(false)
  })

  it('save-succeeded lands on saved when nothing changed since the save started', () => {
    const saving = reduceHandoffAutosave(
      reduceHandoffAutosave(createHandoffAutosaveState('hello'), {
        type: 'edit',
        text: 'hello world'
      }),
      { type: 'flush' }
    )
    const saved = reduceHandoffAutosave(saving, { type: 'save-succeeded', text: 'hello world' })
    expect(saved).toEqual({ status: 'saved', text: 'hello world', savedText: 'hello world' })
  })

  it('save-succeeded stays dirty when the buffer moved on during the save', () => {
    const saving = reduceHandoffAutosave(
      reduceHandoffAutosave(createHandoffAutosaveState('hello'), {
        type: 'edit',
        text: 'hello world'
      }),
      { type: 'flush' }
    )
    const stillTyping = reduceHandoffAutosave(saving, { type: 'edit', text: 'hello world!' })
    const result = reduceHandoffAutosave(stillTyping, {
      type: 'save-succeeded',
      text: 'hello world'
    })
    expect(result.status).toBe('dirty')
    expect(result.text).toBe('hello world!')
    expect(result.savedText).toBe('hello world')
  })

  it('save-failed marks the state as errored without losing the buffer', () => {
    const saving = reduceHandoffAutosave(
      reduceHandoffAutosave(createHandoffAutosaveState('hello'), {
        type: 'edit',
        text: 'hello world'
      }),
      { type: 'flush' }
    )
    const failed = reduceHandoffAutosave(saving, { type: 'save-failed' })
    expect(failed.status).toBe('error')
    expect(failed.text).toBe('hello world')
  })
})
