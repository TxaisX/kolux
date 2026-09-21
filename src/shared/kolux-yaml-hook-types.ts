export type SetupRunPolicy = 'ask' | 'run-by-default' | 'skip-by-default'
export type SetupAgentStartupPolicy = 'start-immediately' | 'wait-for-setup'
export type HookCommandSourcePolicy = 'shared-only' | 'local-only' | 'run-both'

// ─── Hooks (kolux.yaml) ──────────────────────────────────────────────
export type KoluxHooks = {
  scripts: {
    setup?: string // Runs after worktree is created
    archive?: string // Runs before worktree is archived
  }
  setupAgentStartupPolicy?: SetupAgentStartupPolicy
  issueCommand?: string // Shared default command for linked GitHub issues
  defaultTabs?: KoluxDefaultTabTemplate[] // Terminal tabs to create once for a new worktree
  environmentRecipes?: KoluxVmRecipe[] // Project-scoped per-workspace environment recipes
  environmentRecipeDiagnostics?: KoluxVmRecipeDiagnostic[] // Non-fatal validation issues from environmentRecipes
  worktree?: KoluxWorktreeDefaults // Project-scoped defaults applied when a worktree is created
}

export type KoluxWorktreeDefaults = {
  // Why: shared (symlinked) rather than copied — large rebuildable dirs like
  // node_modules should be one install serving every worktree.
  sharedDirectories?: string[]
}

export type KoluxDefaultTabTemplate = {
  title?: string
  color?: string
  command?: string
}

export type EphemeralVmCheckoutMode = 'kolux-worktree' | 'provisioned-root'

export type KoluxVmRecipe = {
  id: string
  name: string
  create: string
  checkoutMode?: EphemeralVmCheckoutMode
  description?: string
  suspend?: string
  resume?: string
  destroy?: string
  destroyDisabled?: boolean
}

export type KoluxVmRecipeDiagnostic = {
  index: number
  field?: string
  message: string
}

export type RepoHookSettings = {
  // Why: persisted data may still include the old mode field from the earlier
  // hook UI. Keep it in the shape so existing local state reads without a migration.
  mode: 'auto' | 'override'
  setupRunPolicy?: SetupRunPolicy
  setupAgentStartupPolicy?: SetupAgentStartupPolicy
  commandSourcePolicy?: HookCommandSourcePolicy
  scripts: {
    setup: string
    archive: string
  }
}

export type PersistedTrustedKoluxHookEntry = {
  contentHash: string
  approvedAt: number
}

export type PersistedTrustedKoluxHookRepo = {
  all?: {
    approvedAt: number
  }
  setup?: PersistedTrustedKoluxHookEntry
  archive?: PersistedTrustedKoluxHookEntry
  issueCommand?: PersistedTrustedKoluxHookEntry
  vmRecipe?: PersistedTrustedKoluxHookEntry
}

export type PersistedTrustedKoluxHooks = Record<string, PersistedTrustedKoluxHookRepo>
