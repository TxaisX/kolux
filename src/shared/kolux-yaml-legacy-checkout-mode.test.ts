import { describe, expect, it } from 'vitest'
import { parseKoluxYaml } from './kolux-yaml'

describe('kolux.yaml environmentRecipes.checkoutMode legacy spelling', () => {
  it('normalizes the pre-rename nightshift-worktree spelling to kolux-worktree', () => {
    const result = parseKoluxYaml(`
environmentRecipes:
  - id: sandbox
    name: Sandbox
    create: ./create.sh
    checkoutMode: nightshift-worktree
`)
    expect(result?.environmentRecipes?.[0]?.checkoutMode).toBe('kolux-worktree')
  })

  it('still accepts the current kolux-worktree spelling', () => {
    const result = parseKoluxYaml(`
environmentRecipes:
  - id: sandbox
    name: Sandbox
    create: ./create.sh
    checkoutMode: kolux-worktree
`)
    expect(result?.environmentRecipes?.[0]?.checkoutMode).toBe('kolux-worktree')
  })

  it('still rejects an unrelated checkoutMode value', () => {
    const result = parseKoluxYaml(`
environmentRecipes:
  - id: sandbox
    name: Sandbox
    create: ./create.sh
    checkoutMode: bogus-mode
`)
    expect(result?.environmentRecipes ?? []).toHaveLength(0)
  })
})
