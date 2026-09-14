// Boundary validation for repos:publishRemote — both fields end up as argv to `gh`/`git`
// (execFile-style, no shell), but a value starting with `-` can still be parsed as a flag
// by the target program itself, and an unexpected URL scheme can reach local files or
// arbitrary transports. Reject both before they ever reach a spawned process.

const GITHUB_REPO_NAME_PATTERN = /^[A-Za-z0-9._-]+$/
const ALLOWED_REMOTE_URL_PREFIXES = ['https://', 'ssh://', 'git@']
const MAX_REMOTE_URL_LENGTH = 2048
// Matches `scheme://user:password@host` (a credential embedded as URL userinfo with a
// password part) — not a bare `ssh://git@host`/`git@host:path`, which is normal SSH auth.
const URL_PASSWORD_USERINFO_PATTERN = /:\/\/[^/@\s]+:[^/@\s]*@/
// Any userinfo segment in a URL, for redacting it out of error text before it reaches the renderer.
const URL_USERINFO_PATTERN = /(:\/\/)[^/@\s]+@/g

// oxlint-disable-next-line no-control-regex -- deliberately matching control characters to reject them
const CONTROL_CHARACTER_PATTERN = /[\x00-\x1f\x7f]/

function containsControlCharacters(value: string): boolean {
  return CONTROL_CHARACTER_PATTERN.test(value)
}

export function validateGithubRepoName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) {
    return 'Repository name is required'
  }
  if (trimmed.length > 100) {
    return 'Repository name is too long'
  }
  if (containsControlCharacters(trimmed)) {
    return 'Repository name cannot contain control characters'
  }
  if (trimmed.startsWith('-')) {
    return 'Repository name cannot start with "-"'
  }
  if (!GITHUB_REPO_NAME_PATTERN.test(trimmed)) {
    return 'Repository name can only contain letters, numbers, dots, dashes, and underscores'
  }
  return null
}

export function validateRemoteUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) {
    return 'Remote URL is required'
  }
  if (containsControlCharacters(trimmed)) {
    return 'Remote URL cannot contain control characters'
  }
  if (trimmed.length > MAX_REMOTE_URL_LENGTH) {
    return 'Remote URL is too long'
  }
  if (trimmed.startsWith('-')) {
    return 'Remote URL is invalid'
  }
  if (!ALLOWED_REMOTE_URL_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return 'Remote URL must start with https://, ssh://, or git@'
  }
  if (URL_PASSWORD_USERINFO_PATTERN.test(trimmed)) {
    return 'Remote URL cannot include a password. Use a credential helper instead of embedding a token in the URL.'
  }
  return null
}

/** Redacts any `://user@host` or `://user:pass@host` userinfo out of error text before it
 *  reaches the renderer — errors from `git`/`gh` can echo the remote URL verbatim. */
export function redactUrlUserinfo(text: string): string {
  return text.replace(URL_USERINFO_PATTERN, '$1***@')
}
