// Boundary validation for repos:publishRemote — both fields end up as argv to `gh`/`git`
// (execFile-style, no shell), but a value starting with `-` can still be parsed as a flag
// by the target program itself, and an unexpected URL scheme can reach local files or
// arbitrary transports. Reject both before they ever reach a spawned process.

const GITHUB_REPO_NAME_PATTERN = /^[A-Za-z0-9._-]+$/
const ALLOWED_REMOTE_URL_PREFIXES = ['https://', 'ssh://', 'git@']

export function validateGithubRepoName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) {
    return 'Repository name is required'
  }
  if (trimmed.length > 100) {
    return 'Repository name is too long'
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
  if (trimmed.startsWith('-')) {
    return 'Remote URL is invalid'
  }
  if (!ALLOWED_REMOTE_URL_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return 'Remote URL must start with https://, ssh://, or git@'
  }
  return null
}
