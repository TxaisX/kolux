/* eslint-disable unicorn/no-useless-spread */
// @ts-nocheck -- mechanically split from KoluxRuntimeService; behavior is covered by AST equivalence and characterization tests.
import { KoluxRuntimeWithCollectMobileVisibleGraphChangedWorktrees } from './kolux-runtime-collect-mobile-visible-graph-changed-worktrees'

export class KoluxRuntimeWithWaitForSessionTabsInventoryPublication extends KoluxRuntimeWithCollectMobileVisibleGraphChangedWorktrees {
  protected waitForSessionTabsInventoryPublication(signal?: AbortSignal): Promise<void> {
    if (this.getAuthoritativeSessionTabsInventoryEpoch() !== null) {
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        this.sessionTabsInventoryWaiters.delete(onPublished)
        signal?.removeEventListener('abort', onAbort)
      }
      const onPublished = (): void => {
        cleanup()
        resolve()
      }
      const onAbort = (): void => {
        cleanup()
        reject(new Error('client_disconnected'))
      }
      this.sessionTabsInventoryWaiters.add(onPublished)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) {
        onAbort()
      } else if (this.getAuthoritativeSessionTabsInventoryEpoch() !== null) {
        onPublished()
      }
    })
  }

  protected getAuthoritativeSessionTabsInventoryEpoch(): number | null {
    return this.graphStatus === 'ready' &&
      this.sessionTabsInventoryPublicationEpoch === this.rendererGraphEpoch
      ? this.rendererGraphEpoch
      : null
  }

  protected markSessionTabsInventoryPublished(): void {
    if (this.sessionTabsInventoryPublicationEpoch === this.rendererGraphEpoch) {
      return
    }
    this.sessionTabsInventoryPublicationEpoch = this.rendererGraphEpoch
    for (const publish of [...this.sessionTabsInventoryWaiters]) {
      publish()
    }
  }
}
