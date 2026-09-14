// Default .gitignore proposed for a folder project's first real commit — covers common
// noise (deps, build output, secrets, OS cruft) without knowing the project's stack.
export const DEFAULT_GITIGNORE_LINES = [
  'node_modules/',
  'dist/',
  'build/',
  '.env',
  '.env.*',
  '*.log',
  '.DS_Store',
  'Thumbs.db',
  '__pycache__/',
  '.venv/'
] as const

export const DEFAULT_GITIGNORE_CONTENT = `${DEFAULT_GITIGNORE_LINES.join('\n')}\n`

export const LARGE_FILE_BYTES_THRESHOLD = 50 * 1024 * 1024

// Filenames that commonly hold secrets, matched against the basename only (case-insensitive)
// so a nested `config/secrets.yml` still flags.
const SECRET_NAME_PATTERNS: RegExp[] = [
  /^\.env(\..*)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /^id_rsa/i,
  /\.p12$/i,
  /^credentials/i,
  /secret/i
]

export function looksLikeSecretFile(fileName: string): boolean {
  return SECRET_NAME_PATTERNS.some((pattern) => pattern.test(fileName))
}
