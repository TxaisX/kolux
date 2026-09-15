// One OS window per terminal session, keyed by `${worktreeId}::${tabId}`.
const SEPARATOR = '::'
const MAX_ID_PART_LENGTH = 512

export function makeTerminalWindowSessionKey(worktreeId: string, tabId: string): string {
  return `${worktreeId}${SEPARATOR}${tabId}`
}

/** Guards the boundary: an id containing the separator would make the key ambiguous to parse back. */
export function isValidTerminalWindowIdPart(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_PART_LENGTH &&
    !value.includes(SEPARATOR)
  )
}

export function parseTerminalWindowSessionKey(
  sessionKey: string
): { worktreeId: string; tabId: string } | null {
  const index = sessionKey.indexOf(SEPARATOR)
  if (index <= 0) {
    return null
  }
  const worktreeId = sessionKey.slice(0, index)
  const tabId = sessionKey.slice(index + SEPARATOR.length)
  if (!isValidTerminalWindowIdPart(worktreeId) || !isValidTerminalWindowIdPart(tabId)) {
    return null
  }
  return { worktreeId, tabId }
}
