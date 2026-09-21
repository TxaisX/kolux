import { z } from 'zod'
import { KOLUX_VM_RECIPE_ID_PATTERN, KOLUX_VM_RECIPE_ID_RULE } from '../kolux-yaml'
import type { KoluxVmRecipe } from '../kolux-yaml-hook-types'

const recipeCommandSchema = z
  .string()
  .trim()
  .min(1)
  .max(32 * 1024)
  .refine((value) => !value.includes('\0'), 'must not contain NUL bytes')

const pluginVmRecipeArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(KOLUX_VM_RECIPE_ID_PATTERN, KOLUX_VM_RECIPE_ID_RULE),
    name: z.string().trim().min(1).max(128),
    description: z.string().trim().min(1).max(1024).optional(),
    checkoutMode: z.enum(['kolux-worktree', 'provisioned-root']).optional(),
    create: recipeCommandSchema,
    suspend: recipeCommandSchema.optional(),
    resume: recipeCommandSchema.optional(),
    destroy: z.union([recipeCommandSchema, z.literal('none')]).optional()
  })
  .strict()
  .superRefine((recipe, ctx) => {
    if (Boolean(recipe.suspend) !== Boolean(recipe.resume)) {
      ctx.addIssue({
        code: 'custom',
        path: recipe.suspend ? ['resume'] : ['suspend'],
        message: 'suspend and resume must be declared together'
      })
    }
  })

export type PluginVmRecipeCommand = {
  phase: 'create' | 'suspend' | 'resume' | 'destroy'
  command: string
}

export function parsePluginVmRecipeArtifact(raw: string): KoluxVmRecipe {
  const parsed = pluginVmRecipeArtifactSchema.parse(JSON.parse(raw))
  const destroyDisabled = parsed.destroy === 'none'
  return {
    id: parsed.id,
    name: parsed.name,
    create: parsed.create,
    ...(parsed.checkoutMode ? { checkoutMode: parsed.checkoutMode } : {}),
    ...(parsed.description ? { description: parsed.description } : {}),
    ...(parsed.suspend ? { suspend: parsed.suspend } : {}),
    ...(parsed.resume ? { resume: parsed.resume } : {}),
    ...(parsed.destroy && !destroyDisabled ? { destroy: parsed.destroy } : {}),
    ...(destroyDisabled ? { destroyDisabled: true } : {})
  }
}

export function listPluginVmRecipeCommands(recipe: KoluxVmRecipe): PluginVmRecipeCommand[] {
  return [
    { phase: 'create', command: recipe.create },
    ...(recipe.suspend ? [{ phase: 'suspend' as const, command: recipe.suspend }] : []),
    ...(recipe.resume ? [{ phase: 'resume' as const, command: recipe.resume }] : []),
    ...(recipe.destroy
      ? [{ phase: 'destroy' as const, command: recipe.destroy }]
      : recipe.destroyDisabled
        ? [{ phase: 'destroy' as const, command: 'none' }]
        : [])
  ]
}
