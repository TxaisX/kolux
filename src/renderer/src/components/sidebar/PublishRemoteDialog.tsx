import React, { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useAppStore } from '@/store'
import type { PublishPreviewResult, PublishRemoteProvider } from '../../../../shared/repo-git-publish-types'

/**
 * Sidebar "Publish to remote…" action: pushes an already-local-only git repo to a
 * brand-new remote, either creating a private GitHub repo via `gh`, or wiring up an
 * arbitrary URL (GitLab/other). Always shows the commit/file count and requires
 * confirmation before anything gets pushed.
 */
const PublishRemoteDialog = React.memo(function PublishRemoteDialog() {
  const activeModal = useAppStore((s) => s.activeModal)
  const modalData = useAppStore((s) => s.modalData)
  const closeModal = useAppStore((s) => s.closeModal)
  const isOpen = activeModal === 'publish-remote'
  const repoId = typeof modalData.repoId === 'string' ? modalData.repoId : ''
  const repoDisplayName = useAppStore(
    (s) => s.repos.find((repo) => repo.id === repoId)?.displayName ?? ''
  )

  const [provider, setProvider] = useState<PublishRemoteProvider>('github')
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<PublishPreviewResult | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [publishing, setPublishing] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setProvider('github')
      setVisibility('private')
      setName('')
      setUrl('')
      setPreview(null)
      setPublishing(false)
      return
    }
    if (!repoId) {
      return
    }
    setLoadingPreview(true)
    void (async () => {
      try {
        const result = await window.api.repos.previewPublish({ repoId })
        setPreview(result)
      } catch (err) {
        setPreview({ error: err instanceof Error ? err.message : 'Failed to load publish preview' })
      } finally {
        setLoadingPreview(false)
      }
    })()
  }, [isOpen, repoId])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        closeModal()
      }
    },
    [closeModal]
  )

  const handlePublish = useCallback(() => {
    if (!repoId || !preview || 'error' in preview) {
      return
    }
    setPublishing(true)
    void (async () => {
      try {
        const result = await window.api.repos.publishRemote({
          repoId,
          provider,
          confirmed: true,
          ...(provider === 'github'
            ? { visibility, ...(name.trim() ? { name: name.trim() } : {}) }
            : { url: url.trim() })
        })
        if ('error' in result) {
          throw new Error(result.error)
        }
        toast.success('Project published')
        closeModal()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to publish this project')
      } finally {
        setPublishing(false)
      }
    })()
  }, [repoId, preview, provider, visibility, name, url, closeModal])

  const previewError = preview && 'error' in preview ? preview.error : null
  const canPublish =
    !loadingPreview &&
    !publishing &&
    Boolean(preview) &&
    !previewError &&
    (provider === 'github' || url.trim().length > 0)

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-sm">Publish to remote</DialogTitle>
          <DialogDescription className="text-xs">
            {loadingPreview
              ? 'Checking this project…'
              : previewError
                ? previewError
                : preview && !('error' in preview)
                  ? `${preview.commitCount} commit${preview.commitCount === 1 ? '' : 's'}, ${preview.fileCount} file${preview.fileCount === 1 ? '' : 's'} will be uploaded.`
                  : ''}
          </DialogDescription>
        </DialogHeader>

        {!previewError ? (
          <Tabs value={provider} onValueChange={(value) => setProvider(value as PublishRemoteProvider)}>
            <TabsList>
              <TabsTrigger value="github">GitHub</TabsTrigger>
              <TabsTrigger value="url">Remote URL</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}

        {!previewError && provider === 'github' ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="publish-repo-name" className="text-xs">
                Repository name
              </Label>
              <Input
                id="publish-repo-name"
                placeholder={repoDisplayName || 'repository-name'}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Visibility</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                value={visibility}
                onValueChange={(value) => {
                  if (value) {
                    setVisibility(value as 'private' | 'public')
                  }
                }}
              >
                <ToggleGroupItem value="private">Private</ToggleGroupItem>
                <ToggleGroupItem value="public">Public</ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
        ) : null}

        {!previewError && provider === 'url' ? (
          <div className="space-y-1">
            <Label htmlFor="publish-remote-url" className="text-xs">
              Remote URL
            </Label>
            <Input
              id="publish-remote-url"
              placeholder="https://gitlab.com/owner/repo.git"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handlePublish} disabled={!canPublish}>
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})

export default PublishRemoteDialog
