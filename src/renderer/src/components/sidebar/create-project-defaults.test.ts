import { describe, expect, it } from 'vitest'
import {
  formatCreateProjectParentSummary,
  getCreateProjectDefaultParentAutoFill,
  getDefaultCreateProjectParent,
  joinCreateProjectPath
} from './create-project-defaults'

describe('create project defaults', () => {
  it('builds the POSIX default project parent', () => {
    expect(getDefaultCreateProjectParent('/Users/alice')).toBe('/Users/alice/kolux/projects')
  })

  it('builds the Windows default project parent', () => {
    expect(getDefaultCreateProjectParent('C:\\Users\\alice')).toBe(
      'C:\\Users\\alice\\kolux\\projects'
    )
  })

  it('derives the runtime project default from a resolved server home', () => {
    expect(getDefaultCreateProjectParent('/home/alice')).toBe('/home/alice/kolux/projects')
  })

  it('joins path previews without mixing separators', () => {
    expect(joinCreateProjectPath('/home/alice/kolux/projects', 'demo')).toBe(
      '/home/alice/kolux/projects/demo'
    )
    expect(joinCreateProjectPath('C:\\Users\\alice\\kolux\\projects', 'demo')).toBe(
      'C:\\Users\\alice\\kolux\\projects\\demo'
    )
  })

  it('auto-fills only the first empty local create step', () => {
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '',
        activeRuntimeEnvironmentId: null,
        defaultParent: '/Users/alice/kolux/projects',
        createStepAutoFilled: false
      })
    ).toEqual({ parent: '/Users/alice/kolux/projects' })
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '/tmp/project',
        activeRuntimeEnvironmentId: null,
        defaultParent: '/Users/alice/kolux/projects',
        createStepAutoFilled: false
      })
    ).toBeNull()
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '',
        activeRuntimeEnvironmentId: null,
        defaultParent: '/Users/alice/kolux/projects',
        createStepAutoFilled: true
      })
    ).toBeNull()
  })

  it('does not apply a local default while a runtime environment is active', () => {
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '',
        activeRuntimeEnvironmentId: 'env-1',
        defaultParent: '/Users/alice/kolux/projects',
        createStepAutoFilled: false
      })
    ).toBeNull()
  })

  it('uses a short local summary only for the local default parent', () => {
    expect(
      formatCreateProjectParentSummary({
        parent: '/Users/alice/kolux/projects',
        defaultParent: '/Users/alice/kolux/projects'
      })
    ).toBe('~/kolux/projects')
    expect(
      formatCreateProjectParentSummary({
        parent: '/home/alice/kolux/projects',
        defaultParent: '/home/alice/kolux/projects'
      })
    ).toBe('~/kolux/projects')
    expect(
      formatCreateProjectParentSummary({
        parent: 'C:\\Users\\alice\\kolux\\projects',
        defaultParent: 'C:\\Users\\alice\\kolux\\projects'
      })
    ).toBe('~/kolux/projects')
    expect(
      formatCreateProjectParentSummary({
        parent: '',
        defaultParent: '',
        runtimeEnvironmentId: 'env-1'
      })
    ).toBe('host folder not selected')
    expect(
      formatCreateProjectParentSummary({
        parent: '/Users/alice/kolux/projects',
        defaultParent: '/Users/alice/kolux/projects',
        isRemoteHost: true
      })
    ).toBe('/Users/alice/kolux/projects')
    expect(
      formatCreateProjectParentSummary({
        parent: '',
        defaultParent: '',
        isRemoteHost: true
      })
    ).toBe('host folder not selected')
  })

  it('keeps a configured Workspace Directory verbatim in the summary', () => {
    expect(
      formatCreateProjectParentSummary({
        parent: 'J:\\PROJECTS',
        defaultParent: 'J:\\PROJECTS'
      })
    ).toBe('J:\\PROJECTS')
    expect(
      formatCreateProjectParentSummary({
        parent: '/data/kolux/projects',
        defaultParent: '/data/kolux/projects'
      })
    ).toBe('/data/kolux/projects')
    expect(
      formatCreateProjectParentSummary({
        parent: 'D:\\code\\kolux\\projects',
        defaultParent: 'D:\\code\\kolux\\projects'
      })
    ).toBe('D:\\code\\kolux\\projects')
  })
})
