/** A workspace's handoff document: free-form markdown plus when it was last saved. */
export type WorkspaceHandoffRecord = {
  text: string
  updatedAt: number
}

/** Matches the pre-commit lint's oversized-file guard headroom, not a hard protocol limit. */
export const WORKSPACE_HANDOFF_MAX_TEXT_BYTES = 256 * 1024
