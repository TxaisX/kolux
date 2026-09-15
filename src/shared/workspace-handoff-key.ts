/**
 * Identifies a workspace's handoff document by execution host + filesystem path, so a git
 * worktree and a folder workspace both get one, and a worktree that moves host (SSH vs local)
 * never shares a document with its counterpart on another host.
 *
 * Pure and dependency-free: it must run in both the main process (Node) and the renderer
 * (browser, no `node:crypto`), so the hash below is plain JS, not cryptographic — a workspace
 * count collision is astronomically unlikely at this scale.
 */
export type WorkspaceHandoffLocation = {
  hostId: string
  path: string
}

/** 16 lowercase hex chars — also the shape validated at the IPC boundary. */
export const WORKSPACE_HANDOFF_KEY_PATTERN = /^[0-9a-f]{16}$/

export function buildWorkspaceHandoffKey({ hostId, path }: WorkspaceHandoffLocation): string {
  const normalizedPath = path.trim().replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  return `${fnv1a64(hostId.trim())}${fnv1a64(normalizedPath)}`
}

// Why: two independent 32-bit FNV-1a passes (host, path) concatenated give a 64-bit-wide
// key without needing BigInt — plenty of headroom for the number of workspaces this app manages.
function fnv1a64(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
