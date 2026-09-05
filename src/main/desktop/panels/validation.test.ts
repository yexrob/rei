import { describe, expect, it } from 'vitest'
import { allowedNavigation, browserLayoutSchema, nativeBounds, terminalAckSchema, terminalEnvironment, terminalResizeSchema, terminalWriteSchema, webUrlSchema } from './validation'

const id = '6f8c23f0-98f3-4c68-a8a8-549e4d5e1612'
describe('panel boundary validators', () => {
  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hello', 'about:blank', 'mailto:user@example.test', 'ssh://host', 'https://name:password@example.test', 'not a URL'])('rejects unsafe navigation: %s', (url) => {
    expect(allowedNavigation(url)).toBe(false)
    expect(() => webUrlSchema.parse(url)).toThrow()
  })
  it('accepts and normalizes HTTP(S), including local app previews', () => {
    expect(webUrlSchema.parse('https://example.test')).toBe('https://example.test/')
    expect(allowedNavigation('http://127.0.0.1:3000/preview')).toBe(true)
  })
  it('converts CSS pixels through zoom and clamps to the content area, not screen scale', () => {
    expect(nativeBounds({ x: 100, y: 50, width: 400, height: 300 }, 1.5, { width: 600, height: 400 })).toEqual({ x: 150, y: 75, width: 450, height: 325 })
    expect(nativeBounds({ x: -20, y: -10, width: 100, height: 30 }, 2, { width: 400, height: 300 })).toEqual({ x: 0, y: 0, width: 160, height: 40 })
    expect(nativeBounds({ x: 900, y: 800, width: 20, height: 20 }, 1, { width: 400, height: 300 })).toEqual({ x: 400, y: 300, width: 0, height: 0 })
  })
  it('rejects invalid sizes, arbitrary layout fields, non-finite values and invalid zoom', () => {
    expect(browserLayoutSchema.safeParse({ visible: true, bounds: { x: NaN, y: 0, width: 10, height: 10 } }).success).toBe(false)
    expect(browserLayoutSchema.safeParse({ visible: true, bounds: { x: 0, y: 0, width: -1, height: 10 }, zIndex: 99 }).success).toBe(false)
    expect(() => nativeBounds({ x: 0, y: 0, width: 10, height: 10 }, Infinity, { width: 100, height: 100 })).toThrow()
  })
  it('bounds input, resize and ack values with no arbitrary PTY options', () => {
    expect(terminalWriteSchema.safeParse({ id, data: 'a'.repeat(16384) }).success).toBe(true)
    expect(terminalWriteSchema.safeParse({ id, data: 'a'.repeat(16385) }).success).toBe(false)
    expect(terminalWriteSchema.safeParse({ id, data: 'hello', cwd: '/elsewhere' }).success).toBe(false)
    for (const [cols, rows] of [[0, 1], [501, 24], [80, 301], [2.5, 4], [Infinity, 24]]) expect(terminalResizeSchema.safeParse({ id, cols, rows }).success).toBe(false)
    expect(terminalResizeSchema.safeParse({ id, cols: 80, rows: 24 }).success).toBe(true)
    expect(terminalAckSchema.safeParse({ id, sequence: -1 }).success).toBe(false)
    expect(terminalAckSchema.safeParse({ id: 'old', sequence: 1 }).success).toBe(false)
  })
  it('passes shell necessities without inheriting provider secrets or runtime flags', () => {
    const source = { PATH: '/bin', HOME: '/home/test', LANG: 'en_US.UTF-8', OPENAI_API_KEY: 'test-only', BINGO_TOKEN: 'test-only', NODE_OPTIONS: 'test-only', ELECTRON_RUN_AS_NODE: '1', SSH_AUTH_SOCK: '/private/socket' }
    expect(terminalEnvironment(source, 'darwin')).toEqual({ PATH: '/bin', HOME: '/home/test', LANG: 'en_US.UTF-8', TERM: 'xterm-256color', COLORTERM: 'truecolor' })
    expect(terminalEnvironment({ Path: 'C:\\Windows', SystemRoot: 'C:\\Windows', SECRET: 'test-only' }, 'win32')).toEqual({ Path: 'C:\\Windows', SystemRoot: 'C:\\Windows', TERM: 'xterm-256color', COLORTERM: 'truecolor' })
  })
})
