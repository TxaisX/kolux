// One OS window per terminal session, keyed by `${worktreeId}::${tabId}`.
const SEPARATOR = '::'
const MAX_ID_PART_LENGTH = 512

export function makeTerminalWindowSessionKey(worktreeId: string, tabId: string): string {
  return `${worktreeId}${SEPARATOR}${tabId}`
}

function isBoundedId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_PART_LENGTH
}

/** Worktree ids are `<repoId>::<path>`, so they legitimately contain the separator. */
export function isValidTerminalWindowWorktreeId(value: unknown): value is string {
  return isBoundedId(value)
}

/** Guards the boundary: the tab id is the key's last segment, so it alone must not contain the separator. */
export function isValidTerminalWindowTabId(value: unknown): value is string {
  return isBoundedId(value) && !value.includes(SEPARATOR)
}

export function parseTerminalWindowSessionKey(
  sessionKey: string
): { worktreeId: string; tabId: string } | null {
  // Why: split on the LAST separator; the worktree id itself contains `::`.
  const index = sessionKey.lastIndexOf(SEPARATOR)
  if (index <= 0) {
    return null
  }
  const worktreeId = sessionKey.slice(0, index)
  const tabId = sessionKey.slice(index + SEPARATOR.length)
  if (!isValidTerminalWindowWorktreeId(worktreeId) || !isValidTerminalWindowTabId(tabId)) {
    return null
  }
  return { worktreeId, tabId }
}
