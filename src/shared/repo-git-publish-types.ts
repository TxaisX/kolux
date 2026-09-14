// Shared shapes for the folder-repo git-conversion and remote-publish IPC surface
// (repos:previewInitialCommit / commitInitialFiles / previewPublish / publishRemote).
// Kept in shared/ so preload, renderer, and main all import the same named types.

export type InitialCommitPreviewFileFlags = {
  secret?: true
  large?: true
}

export type InitialCommitPreviewFile = {
  path: string
  size: number
  flags: InitialCommitPreviewFileFlags
}

export type InitialCommitPreviewResult =
  | {
      files: InitialCommitPreviewFile[]
      totalCount: number
      truncated: boolean
      hasWarnings: boolean
      /** Count of flagged (secret/large) files across the FULL tree, not just the displayed slice. */
      flaggedCount: number
      gitignoreExists: boolean
    }
  | { error: string }

export type CommitInitialFilesArgs = {
  repoId: string
  writeDefaultGitignore: boolean
  acknowledgedWarnings?: boolean
}

export type PublishPreviewResult = { commitCount: number; fileCount: number } | { error: string }

export type PublishRemoteProvider = 'github' | 'url'
export type PublishRemoteVisibility = 'private' | 'public'

export type PublishRemoteArgs = {
  repoId: string
  provider: PublishRemoteProvider
  visibility?: PublishRemoteVisibility
  name?: string
  url?: string
  confirmed: boolean
}
