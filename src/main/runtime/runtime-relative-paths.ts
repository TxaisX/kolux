import { posix, win32 } from 'node:path'
import { isWindowsAbsolutePathLike } from '../../shared/cross-platform-path'

// Why: single choke point for every caller below — reject `..`/absolute sub-paths here rather than
// trusting each caller to pre-validate (today's do, but this is the last line of defense).
export function joinWorktreeRelativePath(rootPath: string, relativePath: string): string {
  const normalizedRelativePath = relativePath.replace(/\\/g, '/')
  const pathToValidate = normalizedRelativePath.replace(/\/+$/, '')
  if (pathToValidate !== '' && !isSafeRuntimeRelativePath(pathToValidate)) {
    throw new Error('invalid_relative_path')
  }
  if (isWindowsAbsolutePathLike(rootPath)) {
    return win32.join(rootPath.replace(/\//g, '\\'), ...normalizedRelativePath.split('/'))
  }
  return posix.join(rootPath, ...normalizedRelativePath.split('/'))
}

export function normalizeRuntimeRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalized === '') {
    return ''
  }
  if (!isSafeRuntimeRelativePath(normalized)) {
    throw new Error('invalid_relative_path')
  }
  return normalized
}

export function isSafeRuntimeRelativePath(relativePath: string): boolean {
  if (relativePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(relativePath)) {
    return false
  }
  const parts = relativePath.split('/')
  return parts.every((part) => part !== '' && part !== '.' && part !== '..')
}
