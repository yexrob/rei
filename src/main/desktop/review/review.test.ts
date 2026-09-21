import { beforeEach, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => Promise<any>>(), read: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: (...args: any[]) => Promise<any>) => mocks.handlers.set(name, fn), removeHandler: (name: string) => mocks.handlers.delete(name) } }))
vi.mock('./git', () => ({ readReview: mocks.read }))
import { Review } from './index'
import { REVIEW_IPC } from '../../../shared/review'

beforeEach(() => { mocks.handlers.clear(); mocks.read.mockReset().mockResolvedValue({ status: 'ready', files: [] }) })
function harness() {
  const frame = { url: 'file:///app/index.html' }
  const contents = { mainFrame: frame }
  const window = { webContents: contents, isDestroyed: () => false }
  let cwd = '/approved'
  const review = new Review({ window: () => window as unknown as BrowserWindow, documentUrl: frame.url, workspace: () => cwd })
  const event = { sender: contents, senderFrame: frame }
  const invoke = (input: unknown, sender: { sender: unknown; senderFrame: unknown } = event) => mocks.handlers.get(REVIEW_IPC.snapshot)!(sender, input)
  return { review, invoke, frame, event, setWorkspace: (next: string) => { cwd = next } }
}
it('exposes only read-only snapshot and rejects foreign, subframe and navigated senders', async () => {
  const h = harness()
  expect([...mocks.handlers.keys()]).toEqual(['review:snapshot'])
  for (const sender of [{ sender: {}, senderFrame: h.frame }, { ...h.event, senderFrame: { url: h.frame.url } }]) {
    expect(await h.invoke({ scope: 'unstaged' }, sender)).toMatchObject({ ok: false, error: { code: 'UNTRUSTED_SENDER' } })
  }
  h.frame.url = 'https://foreign.invalid/'
  expect(await h.invoke({ scope: 'staged' })).toMatchObject({ ok: false, error: { code: 'UNTRUSTED_SENDER' } })
  expect(mocks.read).not.toHaveBeenCalled()
})
it('rejects path, argv, shell and unknown scope inputs; reads main-authorized workspace only', async () => {
  const h = harness()
  for (const input of [{ scope: 'unstaged', cwd: '/elsewhere' }, { scope: 'staged', shell: true }, { scope: '--output=/tmp/file' }, { scope: 'staged', argv: ['commit'] }, null]) {
    expect(await h.invoke(input)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
  }
  expect(mocks.read).not.toHaveBeenCalled()
  expect(await h.invoke({ scope: 'staged' })).toMatchObject({ ok: true })
  expect(mocks.read).toHaveBeenCalledWith('/approved', 'staged', expect.any(AbortSignal))
  h.review.close()
  expect(mocks.handlers.size).toBe(0)
})
it('bounds simultaneous requests and discards a result after the workspace changes', async () => {
  const h = harness()
  let resolve!: (value: unknown) => void
  mocks.read.mockImplementation(() => new Promise((done) => { resolve = done }))
  const pending = h.invoke({ scope: 'staged' })
  expect(await h.invoke({ scope: 'unstaged' })).toMatchObject({ ok: false, error: { code: 'REVIEW_BUSY' } })
  h.setWorkspace('/another')
  resolve({ status: 'ready', files: [] })
  expect(await pending).toMatchObject({ ok: false, error: { code: 'STALE_WORKSPACE' } })
})
it('does not leak subprocess stderr and aborts active reads on shutdown', async () => {
  const h = harness()
  mocks.read.mockRejectedValueOnce(new Error('test-only secret stderr'))
  expect(await h.invoke({ scope: 'staged' })).toEqual({ ok: false, error: { code: 'REVIEW_ERROR', message: 'Git review failed. Check that Git is installed and the workspace is readable, then refresh.' } })
  let resolve!: (value: unknown) => void
  mocks.read.mockImplementation(() => new Promise((done) => { resolve = done }))
  const pending = h.invoke({ scope: 'staged' })
  const signal = mocks.read.mock.calls.at(-1)![2] as AbortSignal
  h.review.close()
  expect(signal.aborted).toBe(true)
  resolve({ status: 'ready', files: [] })
  expect(await pending).toMatchObject({ ok: false })
})
