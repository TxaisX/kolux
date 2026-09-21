import type { SkillInstallDestination } from '../../shared/skill-install-contract'
import type { KoluxRuntimeService } from '../runtime/kolux-runtime'

export async function classifySkillCloudInstallTarget(
  runtime: KoluxRuntimeService,
  input: { environmentId?: string; destination: SkillInstallDestination }
): Promise<'local' | 'remote'> {
  return input.environmentId || (await runtime.skillInstallDestinationUsesSsh(input.destination))
    ? 'remote'
    : 'local'
}
