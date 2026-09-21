// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { BingoReviewApi, ReviewSnapshot } from '../../../shared/review'
import { ReviewPanel } from './ReviewPanel'

const snapshot: ReviewSnapshot = { status: 'ready', scope: 'unstaged', totalFiles: 1, additions: 1, deletions: 1, truncated: false, files: [{ path: 'src/example.ts', additions: 1, deletions: 1, binary: false, truncated: false, patch: 'diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-before\n+<script>unsafe()</script>\n' }] }
const props = { visible: true, workspace: '/approved', onClose: vi.fn(), onCompose: vi.fn() }
afterEach(() => { cleanup(); delete window.bingoReview; vi.clearAllMocks() })

it('shows real counts, toggles files, switches scopes and refreshes without write controls', async () => {
  const read = vi.fn<BingoReviewApi['snapshot']>(async (input) => ({ ok: true as const, value: { ...snapshot, scope: input.scope } }))
  window.bingoReview = { snapshot: read }
  const { container } = render(<ReviewPanel {...props} />)
  expect(await screen.findByText('src/example.ts')).toBeTruthy()
  expect(screen.getByText('1 file')).toBeTruthy()
  expect(container.querySelector('script')).toBeNull()
  expect(screen.getByText('+<script>unsafe()</script>')).toBeTruthy()
  const file = screen.getByRole('button', { name: /src\/example.ts/ })
  fireEvent.click(file)
  expect(file.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: 'Staged' }))
  await waitFor(() => expect(read).toHaveBeenCalledWith({ scope: 'staged' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh changes' }).hasAttribute('disabled')).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Refresh changes' }))
  await waitFor(() => expect(read).toHaveBeenCalledTimes(3))
  expect(screen.queryByRole('button', { name: /Commit|Push|Stage all/i })).toBeNull()
})

it('only drafts feedback after an explicit user action', async () => {
  window.bingoReview = { snapshot: vi.fn<BingoReviewApi['snapshot']>(async () => ({ ok: true, value: snapshot })) }
  render(<ReviewPanel {...props} />)
  await screen.findByText('src/example.ts')
  fireEvent.change(screen.getByRole('textbox', { name: 'Feedback for src/example.ts' }), { target: { value: 'Check the escaping.' } })
  fireEvent.change(screen.getByRole('spinbutton', { name: 'New line number (optional)' }), { target: { value: '1' } })
  expect(props.onCompose).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Add to thread' }))
  expect(props.onCompose).toHaveBeenCalledWith(expect.stringContaining('src/example.ts (unstaged, new line 1)'))
  expect(props.onCompose).toHaveBeenCalledWith(expect.stringContaining('Check the escaping.'))
})

it('distinguishes unavailable, non-repository, empty, binary and rejected reads', async () => {
  const view = render(<ReviewPanel {...props} />)
  expect(screen.getByText('Git review is available in the desktop app.')).toBeTruthy()
  view.unmount()
  window.bingoReview = { snapshot: vi.fn<BingoReviewApi['snapshot']>(async () => ({ ok: true, value: { ...snapshot, status: 'not-repository', files: [] } })) }
  const nonrepo = render(<ReviewPanel {...props} />)
  expect(await screen.findByText('This workspace is not a Git repository.')).toBeTruthy()
  nonrepo.unmount()
  window.bingoReview = { snapshot: vi.fn<BingoReviewApi['snapshot']>(async () => ({ ok: true, value: { ...snapshot, files: [], totalFiles: 0 } })) }
  const empty = render(<ReviewPanel {...props} />)
  expect(await screen.findByText('No unstaged changes.')).toBeTruthy()
  empty.unmount()
  window.bingoReview = { snapshot: vi.fn<BingoReviewApi['snapshot']>(async () => ({ ok: true, value: { ...snapshot, files: [{ ...snapshot.files[0], binary: true, patch: null }] } })) }
  const binary = render(<ReviewPanel {...props} />)
  expect(await screen.findByText('Binary file — preview unavailable.')).toBeTruthy()
  binary.unmount()
  window.bingoReview = { snapshot: vi.fn<BingoReviewApi['snapshot']>(async () => { throw new Error('transport') }) }
  render(<ReviewPanel {...props} />)
  expect((await screen.findByRole('alert')).textContent).toBe('Git review could not be loaded. Refresh to try again.')
})

it('does not display a late result from a previous workspace', async () => {
  let resolve!: (value: any) => void
  const read = vi.fn().mockImplementationOnce(() => new Promise((done) => { resolve = done })).mockResolvedValue({ ok: true, value: { ...snapshot, files: [], totalFiles: 0 } })
  window.bingoReview = { snapshot: read }
  const view = render(<ReviewPanel {...props} />)
  view.rerender(<ReviewPanel {...props} workspace="/another" />)
  await screen.findByText('No unstaged changes.')
  resolve({ ok: true, value: snapshot })
  await waitFor(() => expect(screen.queryByText('src/example.ts')).toBeNull())
})
