function getGitErrorText(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return error instanceof Error ? error.message : String(error)
  }
  const values = ['message', 'stderr', 'stdout']
    .map((key) => (error as Record<string, unknown>)[key])
    .filter((value): value is string => typeof value === 'string')
  return values.join('\n')
}

export function isUnsupportedMergeTreeWriteTreeError(error: unknown): boolean {
  const output = getGitErrorText(error)
  return (
    /(?:unknown|invalid|unrecognized) option(?::|\s+)[`']?(?:--?)?write-tree[`']?(?:\s|$)/i.test(
      output
    ) ||
    /unknown rev [`']?--write-tree[`']?(?:\s|$)/i.test(output) ||
    /usage:\s*git merge-tree\s+<base-tree>\s+<branch1>\s+<branch2>/i.test(output)
  )
}

export function isUnsupportedMergeTreeMergeBaseError(error: unknown): boolean {
  const output = getGitErrorText(error)
  return /(?:unknown|invalid|unrecognized) option(?::|\s+)[`']?(?:--?)?merge-base[`']?(?:\s|$)/i.test(
    output
  )
}

/** Raw stdout captured on a thrown git error, or '' when none was attached. */
export function getGitCommandStdout(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return ''
  }
  const stdout = (error as Record<string, unknown>).stdout
  return typeof stdout === 'string' ? stdout : ''
}

/** `git merge-tree --write-tree --name-only -z` output: the tree oid, then NUL-delimited
 *  conflicted paths. Both are NUL-terminated under `-z`, so splitting on `\0` and dropping
 *  the first entry (the tree oid) yields just the paths. */
export function parseMergeTreeNameOnlyOutput(stdout: string): string[] {
  const entries = stdout.split('\0').filter(Boolean)
  if (entries.length === 0) {
    return []
  }
  const [, ...files] = entries
  return files
}
