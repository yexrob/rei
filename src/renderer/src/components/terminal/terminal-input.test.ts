import { expect, it, vi } from 'vitest'
import { TerminalInput, splitTerminalInput } from './terminal-input'

it('chunks paste without splitting Unicode surrogate pairs', () => {
  const data = 'a'.repeat(16383) + '😀' + 'b'.repeat(17000)
  const chunks = splitTerminalInput(data)
  expect(chunks.join('')).toBe(data)
  expect(chunks.every((chunk) => chunk.length <= 16384)).toBe(true)
  expect(chunks[0]).toHaveLength(16383)
  expect(chunks[1].startsWith('😀')).toBe(true)
})

it('serializes per-terminal input without blocking another terminal', async () => {
  let release!: () => void
  const writeA = vi.fn(async (_data: string) => { await new Promise<void>((resolve) => { release = resolve }) })
  const writeB = vi.fn(async (_data: string) => {})
  const a = new TerminalInput(writeA, vi.fn()), b = new TerminalInput(writeB, vi.fn())
  a.push('first'); a.push('second'); b.push('independent')
  expect(writeA.mock.calls).toEqual([['first']])
  expect(writeB.mock.calls).toEqual([['independent']])
  release(); await Promise.resolve(); await Promise.resolve()
  expect(writeA.mock.calls).toEqual([['first'], ['second']])
  a.dispose(); b.dispose(); release()
})

it('bounds paste queues, reports failed writes and drops queued input after disposal', async () => {
  const failed = vi.fn()
  const input = new TerminalInput(async () => { throw new Error('Disconnected') }, failed)
  input.push('x'.repeat(1024 * 1024 + 1))
  expect(failed).toHaveBeenCalledWith('Terminal input is too large. Paste a smaller amount.')
  input.push('test'); await Promise.resolve(); await Promise.resolve()
  expect(failed).toHaveBeenCalledWith('Disconnected')
  input.dispose(); failed.mockClear(); input.push('after dispose')
  expect(failed).not.toHaveBeenCalled()
})
