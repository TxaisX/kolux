import { getEphemeralVmRecipeResultCheckoutMode } from './ephemeral-vm-recipes'
import type { EphemeralVmRecipeResult } from './ephemeral-vm-recipes'
import type { KoluxVmRecipe } from './kolux-yaml-hook-types'

// Why: repos written before the Nightshift->Kolux rename may still spell this "nightshift-worktree" in kolux.yaml.
const LEGACY_NIGHTSHIFT_WORKTREE_CHECKOUT_MODE = 'nightshift-worktree'

/** Accept the pre-rename spelling of the default checkout mode wherever a user typed it into yaml. */
export function normalizeLegacyCheckoutModeSpelling(value: string): string {
  return value === LEGACY_NIGHTSHIFT_WORKTREE_CHECKOUT_MODE ? 'kolux-worktree' : value
}

export function getEphemeralVmRecipeResultSchemaVersion(recipe: KoluxVmRecipe): 1 | 2 {
  return recipe.checkoutMode === 'provisioned-root' ? 2 : 1
}

export function getEphemeralVmRecipeCheckoutModeError(
  recipe: KoluxVmRecipe,
  result: EphemeralVmRecipeResult
): string | null {
  const configuredMode = recipe.checkoutMode ?? 'kolux-worktree'
  const resultMode = getEphemeralVmRecipeResultCheckoutMode(result)
  if (configuredMode === resultMode) {
    return null
  }
  return configuredMode === 'provisioned-root'
    ? 'Provisioned-root recipes must return schemaVersion 2 with checkoutMode "provisioned-root".'
    : 'Recipe result requests provisioned-root checkout, but the recipe is not configured for it.'
}
