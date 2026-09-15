import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getPathMock, handleMock, readMock, writeMock } = vi.hoisted(() => ({
  getPathMock: vi.fn(() => '/fake/userData'),
  handleMock: vi.fn(),
  readMock: vi.fn(),
  writeMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: getPathMock },
  ipcMain: { handle: handleMock }
}))

vi.mock('../workspace-handoff/workspace-handoff-store', () => ({
  WORKSPACE_HANDOFF_DIR_NAME: 'workspace-handoffs',
  WorkspaceHandoffStore: vi.fn(function WorkspaceHandoffStore(this: unknown) {
    return { read: readMock, write: writeMock }
  })
}))

import { registerWorkspaceHandoffHandlers } from './workspace-handoff'

const VALID_KEY = 'abcdef0123456789'

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = handleMock.mock.calls.find(([registeredChannel]) => registeredChannel === channel)
  if (!call) {
    throw new Error(`No handler registered for ${channel}`)
  }
  return call[1] as (...args: unknown[]) => unknown
}

describe('registerWorkspaceHandoffHandlers', () => {
  beforeEach(() => {
    handleMock.mockReset()
    readMock.mockReset()
    writeMock.mockReset()
    registerWorkspaceHandoffHandlers()
  })

  describe('workspaceHandoff:get', () => {
    it('rejects a malformed key', () => {
      const handler = getHandler('workspaceHandoff:get')
      expect(() => handler({}, 'not-a-valid-key')).toThrow(/Invalid workspace handoff key/)
      expect(readMock).not.toHaveBeenCalled()
    })

    it('rejects a non-string key', () => {
      const handler = getHandler('workspaceHandoff:get')
      expect(() => handler({}, 42)).toThrow(/Invalid workspace handoff key/)
    })

    it('reads through to the store for a valid key', () => {
      readMock.mockReturnValue({ text: 'hi', updatedAt: 1 })
      const handler = getHandler('workspaceHandoff:get')
      expect(handler({}, VALID_KEY)).toEqual({ text: 'hi', updatedAt: 1 })
      expect(readMock).toHaveBeenCalledWith(VALID_KEY)
    })
  })

  describe('workspaceHandoff:set', () => {
    it('rejects a malformed key', () => {
      const handler = getHandler('workspaceHandoff:set')
      expect(() => handler({}, 'bad key', 'text')).toThrow(/Invalid workspace handoff key/)
      expect(writeMock).not.toHaveBeenCalled()
    })

    it('rejects non-string text', () => {
      const handler = getHandler('workspaceHandoff:set')
      expect(() => handler({}, VALID_KEY, 123)).toThrow(/must be a string/)
    })

    it('rejects text over the size cap', () => {
      const handler = getHandler('workspaceHandoff:set')
      const oversized = 'a'.repeat(256 * 1024 + 1)
      expect(() => handler({}, VALID_KEY, oversized)).toThrow(/too large/)
      expect(writeMock).not.toHaveBeenCalled()
    })

    it('writes through to the store for valid input', () => {
      writeMock.mockReturnValue({ text: 'hi', updatedAt: 2 })
      const handler = getHandler('workspaceHandoff:set')
      expect(handler({}, VALID_KEY, 'hi')).toEqual({ text: 'hi', updatedAt: 2 })
      expect(writeMock).toHaveBeenCalledWith(VALID_KEY, 'hi')
    })
  })
})
