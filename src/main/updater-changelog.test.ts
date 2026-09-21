import { describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()

vi.mock('electron', () => ({
  net: { fetch: (...args: unknown[]) => fetchMock(...args) }
}))

import { fetchChangelog } from './updater-changelog'

describe('fetchChangelog', () => {
  // Why: FORK_NO_PHONE_HOME — the changelog is never fetched from the old project's servers.
  it('returns null without a network request', async () => {
    await expect(fetchChangelog('1.1.21', '1.1.20')).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
