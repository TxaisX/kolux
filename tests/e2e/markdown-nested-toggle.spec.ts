import { readFileSync } from 'node:fs'
import { test, expect } from './helpers/kolux-app'
import {
  cleanupMarkdownFixture,
  closeActiveEditorTab,
  createMarkdownFixture,
  getActiveWorktreeContext,
  openMarkdownFixture,
  waitForRichMarkdownEditor
} from './helpers/markdown-editor-fixture'
import {
  expectEditableNestedToggles,
  expectFileKeepsNesting,
  expectPassthroughFallback,
  expectSentinelInsideNestedToggle,
  NESTED_TOGGLE_FIXTURE_DIRECTORY,
  NESTED_TOGGLE_MARKDOWN,
  placeCaretInNestedToggleBody,
  UNSUPPORTED_NESTED_TOGGLE_MARKDOWN
} from './helpers/markdown-nested-toggle'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test.describe('Markdown nested toggle regression', () => {
  test.beforeEach(async ({ koluxPage }) => {
    await waitForSessionReady(koluxPage)
    await waitForActiveWorktree(koluxPage)
  })

  test('a nested toggle on disk reopens as editable toggles', async ({ koluxPage }, testInfo) => {
    const context = await getActiveWorktreeContext(koluxPage)
    let filePath: string | null = null

    try {
      filePath = await createMarkdownFixture(
        context,
        NESTED_TOGGLE_FIXTURE_DIRECTORY,
        'nested-toggle-reopen',
        testInfo.workerIndex,
        NESTED_TOGGLE_MARKDOWN
      )
      await openMarkdownFixture(koluxPage, context, filePath)
      await waitForRichMarkdownEditor(koluxPage)

      await expectEditableNestedToggles(koluxPage)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })

  test('editing a nested toggle survives save and reopen', async ({ koluxPage }, testInfo) => {
    const context = await getActiveWorktreeContext(koluxPage)
    const sentinel = `editedInsideNestedToggle${Date.now()}`
    let filePath: string | null = null

    try {
      filePath = await createMarkdownFixture(
        context,
        NESTED_TOGGLE_FIXTURE_DIRECTORY,
        'nested-toggle-edit',
        testInfo.workerIndex,
        NESTED_TOGGLE_MARKDOWN
      )
      await openMarkdownFixture(koluxPage, context, filePath)
      await waitForRichMarkdownEditor(koluxPage)
      await expectEditableNestedToggles(koluxPage)

      await placeCaretInNestedToggleBody(koluxPage)
      await koluxPage.keyboard.type(` ${sentinel}`)
      await expectSentinelInsideNestedToggle(koluxPage, sentinel)

      // Save through the real shortcut and assert the bytes that landed on disk.
      await koluxPage.keyboard.press('ControlOrMeta+S')
      const savedPath = filePath
      await expect
        .poll(() => readFileSync(savedPath, 'utf8'), { timeout: 10_000 })
        .toContain(sentinel)
      expectFileKeepsNesting(readFileSync(savedPath, 'utf8'), sentinel)

      // The reported bug only appeared on reopen, so close the tab and parse
      // the saved file again from scratch.
      await closeActiveEditorTab(koluxPage, savedPath)
      await openMarkdownFixture(koluxPage, context, savedPath)
      await waitForRichMarkdownEditor(koluxPage)
      await expectEditableNestedToggles(koluxPage)
      await expectSentinelInsideNestedToggle(koluxPage, sentinel)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })

  test('a nested toggle that cannot be represented stays raw passthrough', async ({
    koluxPage
  }, testInfo) => {
    const context = await getActiveWorktreeContext(koluxPage)
    let filePath: string | null = null

    try {
      filePath = await createMarkdownFixture(
        context,
        NESTED_TOGGLE_FIXTURE_DIRECTORY,
        'nested-toggle-unsupported',
        testInfo.workerIndex,
        UNSUPPORTED_NESTED_TOGGLE_MARKDOWN
      )
      await openMarkdownFixture(koluxPage, context, filePath)
      await waitForRichMarkdownEditor(koluxPage)

      await expectPassthroughFallback(koluxPage)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })
})
