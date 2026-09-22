import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('headless PTY registry hydration ordering', () => {
  it('uses exactly one deferred-or-immediate desktop hydration path', () => {
    // Why normalize: this file has CRLF line endings on Windows checkouts, which would
    // never match the LF-literal substrings asserted below.
    const source = readFileSync(
      join(process.cwd(), 'src/main/window/attach-main-window-services.ts'),
      'utf8'
    ).replace(/\r\n/g, '\n')
    const start = source.indexOf('const localPtyProviderStartupReady =')
    const end = source.indexOf('registerSshHandlers(', start)
    const hydration = source.slice(start, end)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(hydration).toContain('if (localPtyProviderStartupReady)')
    expect(hydration).toContain('.then(() => hydrateLocalPtyRegistryAtBoot(store))')
    expect(hydration).toContain('} else {\n    void hydrateLocalPtyRegistryAtBoot(store)')
    expect(hydration.match(/hydrateLocalPtyRegistryAtBoot\(store\)/g)).toHaveLength(2)
  })

  it('hydrates Electron serve after provider and handler readiness but before RPC', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/main/startup/main-process-runtime-launch.ts'),
      'utf8'
    )
    const serve = source.indexOf('async function launchServeMode(')
    const provider = source.indexOf('await state.localPtyProviderStartupReady', serve)
    const handlersAndHydration = source.indexOf('await registerHeadlessPtyRuntime(', provider)
    const rpc = source.indexOf('await runtimeRpc.start()', handlersAndHydration)
    const readiness = source.indexOf('await printServeReady(serveOptions)', rpc)

    expect(serve).toBeGreaterThanOrEqual(0)
    expect(provider).toBeGreaterThan(serve)
    expect(handlersAndHydration).toBeGreaterThan(provider)
    expect(rpc).toBeGreaterThan(handlersAndHydration)
    expect(readiness).toBeGreaterThan(rpc)
  })

  it('hydrates koluxd after Store and daemon readiness but before RPC and publication', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/koluxd/koluxd-entry.ts'), 'utf8')
    const store = source.indexOf('const store = new Store(')
    const daemon = source.indexOf('await startKoluxdDaemon()', store)
    const handlersAndHydration = source.indexOf('await registerHeadlessPtyRuntime(', daemon)
    const rpc = source.indexOf('await rpc.start()', handlersAndHydration)
    const readiness = source.indexOf('await new ServeReadinessPublisher().publish(', rpc)

    expect(store).toBeGreaterThanOrEqual(0)
    expect(daemon).toBeGreaterThan(store)
    expect(handlersAndHydration).toBeGreaterThan(daemon)
    expect(rpc).toBeGreaterThan(handlersAndHydration)
    expect(readiness).toBeGreaterThan(rpc)
  })
})
