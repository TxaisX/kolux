import { describe, expect, it } from 'vitest'
import {
  getEphemeralVmRecipeCheckoutModeError,
  getEphemeralVmRecipeResultSchemaVersion,
  normalizeLegacyCheckoutModeSpelling
} from './ephemeral-vm-recipe-checkout-mode'
import type { KoluxVmRecipe } from './kolux-yaml-hook-types'

const defaultRecipe: KoluxVmRecipe = {
  id: 'cloud-sandbox',
  name: 'Cloud Sandbox',
  create: './create.sh'
}

describe('ephemeral VM recipe checkout mode', () => {
  it('keeps existing recipes on schema version 1', () => {
    expect(getEphemeralVmRecipeResultSchemaVersion(defaultRecipe)).toBe(1)
    expect(
      getEphemeralVmRecipeCheckoutModeError(defaultRecipe, {
        schemaVersion: 1,
        pairingCode: 'kolux://pair?code=test',
        projectRoot: '/workspace/repo'
      })
    ).toBeNull()
  })

  it('requires both sides to opt in to provisioned-root', () => {
    const provisionedRootResult = {
      schemaVersion: 2 as const,
      checkoutMode: 'provisioned-root' as const,
      pairingCode: 'kolux://pair?code=test',
      projectRoot: '/workspace/repo'
    }
    expect(getEphemeralVmRecipeCheckoutModeError(defaultRecipe, provisionedRootResult)).toBe(
      'Recipe result requests provisioned-root checkout, but the recipe is not configured for it.'
    )
    expect(
      getEphemeralVmRecipeCheckoutModeError(
        { ...defaultRecipe, checkoutMode: 'provisioned-root' },
        provisionedRootResult
      )
    ).toBeNull()
  })

  it('normalizes the pre-rename nightshift-worktree spelling to kolux-worktree', () => {
    expect(normalizeLegacyCheckoutModeSpelling('nightshift-worktree')).toBe('kolux-worktree')
    expect(normalizeLegacyCheckoutModeSpelling('kolux-worktree')).toBe('kolux-worktree')
    expect(normalizeLegacyCheckoutModeSpelling('provisioned-root')).toBe('provisioned-root')
  })
})
