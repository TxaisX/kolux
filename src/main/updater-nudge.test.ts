import { beforeEach, describe, expect, it, vi } from 'vitest'

const { netFetchMock } = vi.hoisted(() => ({
  netFetchMock: vi.fn()
}))

vi.mock('electron', () => ({
  net: { fetch: netFetchMock }
}))

import { fetchNudge, versionMatchesRange, shouldApplyNudge } from './updater-nudge'

describe('updater-nudge', () => {
  beforeEach(() => {
    netFetchMock.mockReset()
  })

  describe('fetchNudge', () => {
    // Why: FORK_NO_PHONE_HOME — nudge campaigns are never fetched from the old project's servers.
    it('returns null without a network request', async () => {
      await expect(fetchNudge()).resolves.toBeNull()
      expect(netFetchMock).not.toHaveBeenCalled()
    })
  })

  describe('versionMatchesRange', () => {
    it('bounded range match', () => {
      expect(versionMatchesRange('1.1.5', { minVersion: '1.1.0', maxVersion: '1.1.19' })).toBe(true)
      expect(versionMatchesRange('1.1.0', { minVersion: '1.1.0', maxVersion: '1.1.19' })).toBe(true)
      expect(versionMatchesRange('1.1.19', { minVersion: '1.1.0', maxVersion: '1.1.19' })).toBe(
        true
      )
      expect(versionMatchesRange('1.0.9', { minVersion: '1.1.0', maxVersion: '1.1.19' })).toBe(
        false
      )
      expect(versionMatchesRange('1.2.0', { minVersion: '1.1.0', maxVersion: '1.1.19' })).toBe(
        false
      )
    })

    it('upper-only range match', () => {
      expect(versionMatchesRange('1.1.5', { maxVersion: '1.1.19' })).toBe(true)
      expect(versionMatchesRange('1.2.0', { maxVersion: '1.1.19' })).toBe(false)
    })

    it('lower-only range match', () => {
      expect(versionMatchesRange('1.1.5', { minVersion: '1.1.0' })).toBe(true)
      expect(versionMatchesRange('1.0.0', { minVersion: '1.1.0' })).toBe(false)
    })
  })

  describe('shouldApplyNudge', () => {
    const nudge = { id: 'campaign-1', minVersion: '1.0.0' }

    it('returns true when version matches and not dismissed/pending', () => {
      expect(
        shouldApplyNudge({
          nudge,
          appVersion: '1.5.0',
          pendingUpdateNudgeId: null,
          dismissedUpdateNudgeId: null
        })
      ).toBe(true)
    })

    it('returns false when campaign already dismissed', () => {
      expect(
        shouldApplyNudge({
          nudge,
          appVersion: '1.5.0',
          pendingUpdateNudgeId: null,
          dismissedUpdateNudgeId: 'campaign-1'
        })
      ).toBe(false)
    })

    it('returns false when campaign is already pending', () => {
      expect(
        shouldApplyNudge({
          nudge,
          appVersion: '1.5.0',
          pendingUpdateNudgeId: 'campaign-1',
          dismissedUpdateNudgeId: null
        })
      ).toBe(false)
    })

    it('returns false when version does not match', () => {
      expect(
        shouldApplyNudge({
          nudge,
          appVersion: '0.9.0',
          pendingUpdateNudgeId: null,
          dismissedUpdateNudgeId: null
        })
      ).toBe(false)
    })
  })
})
