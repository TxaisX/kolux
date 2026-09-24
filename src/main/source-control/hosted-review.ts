import type { ExecutionHostId } from '../../shared/execution-host'
import type { HostedReviewInfo } from '../../shared/hosted-review'
import { assertRemoteUrlReadable } from '../git/remote-url-probe'
import { getForgeProviderForRepository, type ForgeProviderId } from './forge-provider'
import { hostedReviewSshConnectionId } from './hosted-review-execution-host'
import { withHostedReviewBranchCache } from './hosted-review-branch-cache'
import {
  getHostedReviewLocalGitOptions,
  type HostedReviewExecutionOptions
} from './hosted-review-git-options'

export type HostedReviewObservedIdentity = {
  repoPath: string
  executionHostId: ExecutionHostId
  branch: string
}

export type HostedReviewObserver = (
  identity: HostedReviewObservedIdentity,
  review: HostedReviewInfo | null
) => void

let observer: HostedReviewObserver | null = null

/** Event detection taps a resolved lookup here — never called on a throw, so a
 *  provider outage cannot be read as "review went away". */
export function setHostedReviewObserver(next: HostedReviewObserver | null): void {
  observer = next
}

function reviewLinkForProvider(
  input: Parameters<typeof getHostedReviewForBranch>[0],
  provider: ForgeProviderId
): { linkedReviewNumber?: number | null; fallbackReviewNumber?: number | null } {
  switch (provider) {
    case 'github':
      return {
        linkedReviewNumber: input.linkedGitHubPR ?? null,
        fallbackReviewNumber: input.linkedGitHubPR == null ? (input.fallbackGitHubPR ?? null) : null
      }
    case 'gitlab':
      return { linkedReviewNumber: input.linkedGitLabMR ?? null }
    case 'bitbucket':
      return { linkedReviewNumber: input.linkedBitbucketPR ?? null }
    case 'azure-devops':
      return { linkedReviewNumber: input.linkedAzureDevOpsPR ?? null }
    case 'gitea':
      return { linkedReviewNumber: input.linkedGiteaPR ?? null }
  }
}

export async function getHostedReviewForBranch(
  input: {
    repoPath: string
    executionHostId: ExecutionHostId
    branch: string
    linkedGitHubPR?: number | null
    fallbackGitHubPR?: number | null
    linkedGitLabMR?: number | null
    linkedBitbucketPR?: number | null
    linkedAzureDevOpsPR?: number | null
    linkedGiteaPR?: number | null
    currentHeadOid?: string | null
    /**
     * Set by surfaces that only ever render the selected worktree, which is the
     * one branch cheap enough to re-check per minute (#11532).
     */
    active?: boolean
  } & HostedReviewExecutionOptions
): Promise<HostedReviewInfo | null> {
  const branchName = input.branch.replace(/^refs\/heads\//, '')
  // Why: detached HEAD cannot use branch lookup, but provider-specific exact
  // ids can still resolve the review without probing an empty branch name.
  if (
    !branchName &&
    input.linkedGitHubPR == null &&
    input.fallbackGitHubPR == null &&
    input.linkedGitLabMR == null &&
    input.linkedBitbucketPR == null &&
    input.linkedAzureDevOpsPR == null &&
    input.linkedGiteaPR == null
  ) {
    return null
  }

  const headOid = input.currentHeadOid?.trim() || null
  // Why (#11532): every client polls this one entry point, and they share the
  // host's per-user API quota, so the cache has to sit above the provider call.
  const review = await withHostedReviewBranchCache(
    { ...input, branch: branchName },
    { headOid, ...(input.active === true ? { active: true } : {}) },
    async () => {
      const provider = await getForgeProviderForRepository({
        repoPath: input.repoPath,
        executionHostId: input.executionHostId,
        ...(input.localGitExecOptions ? { localGitExecOptions: input.localGitExecOptions } : {})
      })
      if (!provider) {
        // Why: forge detection swallows probe failures, so a remote read that
        // was killed on its deadline (or lost its relay) would otherwise be
        // cached as a definitive "no review" for the whole no-review interval.
        // Throwing keeps it on the cache's failure path instead (P1-D).
        await assertRemoteUrlReadable({
          repoPath: input.repoPath,
          // The probe is the leaf that still dials: it takes the SSH target, not the host id.
          connectionId: hostedReviewSshConnectionId(input.executionHostId),
          ...getHostedReviewLocalGitOptions(input)
        })
        return null
      }
      return provider.getReviewForBranch({
        repoPath: input.repoPath,
        executionHostId: input.executionHostId,
        branch: branchName,
        ...(input.localGitExecOptions ? { localGitExecOptions: input.localGitExecOptions } : {}),
        githubCurrentHeadOid: headOid,
        ...reviewLinkForProvider(input, provider.id)
      })
    }
  )
  observer?.({ repoPath: input.repoPath, executionHostId: input.executionHostId, branch: branchName }, review)
  return review
}
