import { describe, expect, it } from 'vitest'
import { looksLikeSecretFile } from './initial-commit-defaults'

describe('looksLikeSecretFile', () => {
  it.each(['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', '.npmrc', '.pypirc', '.git-credentials', '.netrc', 'vault.kdbx'])(
    'flags %s',
    (name) => {
      expect(looksLikeSecretFile(name)).toBe(true)
    }
  )

  it.each(['id_rsa.pub', 'id_dsa.pub', 'id_ecdsa.pub', 'id_ed25519.pub'])(
    'does not flag the public counterpart %s',
    (name) => {
      expect(looksLikeSecretFile(name)).toBe(false)
    }
  )

  it('does not flag an unrelated file', () => {
    expect(looksLikeSecretFile('readme.md')).toBe(false)
  })
})
