import { stripCredentialsFromMessage } from './git-remote-error'
import type { KoluxVmRecipe } from './kolux-yaml-hook-types'

export function getProvisionedRootRecipeRepoUrl(
  checkoutMode: KoluxVmRecipe['checkoutMode'],
  remoteUrl: string | undefined
): string | undefined {
  if (checkoutMode !== 'provisioned-root' || !remoteUrl) {
    return undefined
  }
  return stripCredentialsFromMessage(remoteUrl)
}
