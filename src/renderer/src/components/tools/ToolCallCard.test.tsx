// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToolCallCard } from './ToolCallCard'
import type { ToolCallItem } from '../../state/session'

const actions = { openLink: vi.fn(), runAction: vi.fn() }
afterEach(() => { cleanup(); vi.clearAllMocks() })
function fixture(name: string, input: unknown, text = ''): ToolCallItem {
  return { id: 'tool-card', startedAt: '2026-09-17T00:00:00Z', status: 'completed', body: {
    kind: 'toolCall', callId: 'call', name, input, output: { parts: [{ type: 'text', text }] }
  } }
}
function expand() { fireEvent.click(screen.getByRole('button', { name: /^Show tool details:/ })) }

describe('semantic tool cards', () => {
  it('presents the shell command and actual exit without primary JSON', () => {
    const { container } = render(<ToolCallCard item={fixture('Bash', { command: 'npm test', timeout: 5000 }, '$ npm test\n2 failed\n[Exited with code 1]')} {...actions} />)
    expect(screen.getByText('npm test')).toBeTruthy()
    expect(container.querySelector('.tool-diagnostics')).toBeNull()
    expand()
    expect(screen.getByText('Exit 1')).toBeTruthy()
    expect(screen.getByText('2 failed')).toBeTruthy()
    expect(container.querySelector('.tool-diagnostics')?.hasAttribute('open')).toBe(false)
  })

  it('renders search results as inert rows without breaking colon-bearing paths', () => {
    const text = 'C:\\project\\a.ts:14:const x = 1\n[… 5 lines truncated …]'
    render(<ToolCallCard item={fixture('Grep', { pattern: 'const', path: 'C:\\project', output_mode: 'content' }, text)} {...actions} />)
    expand()
    expect(screen.getByText('C:\\project\\a.ts:14:const x = 1')).toBeTruthy()
    expect(screen.getByText('[… 5 lines truncated …]')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('keeps MCP tools generic, with structured results and hidden raw diagnostics', () => {
    const item = fixture('mcp__files__Write', { file_path: '/tmp/demo.html', content: '<script>evil()</script>' }, '{"ok":true,"count":2}')
    const { container } = render(<ToolCallCard item={item} {...actions} />)
    expect(screen.getByText('files')).toBeTruthy()
    expect(container.querySelector('[data-tool-family="file"]')).toBeNull()
    expand()
    expect(screen.getByText('ok')).toBeTruthy()
    expect(screen.getByText('true')).toBeTruthy()
    expect(container.querySelector('script, iframe')).toBeNull()
    expect(screen.queryByRole('button', { name: /preview/i })).toBeNull()
  })

  it('uses canonical display and never fetches remote or SVG images', () => {
    const item = fixture('mcp__server__browse', {}, '{"ignored":true}')
    item.body.output = { parts: [{ type: 'text', text: '![remote](https://example.com/p.png)' }, { type: 'image', mediaType: 'image/svg+xml', data: 'evil' }], display: { kind: 'keyValue', rows: [['Answer', '42']] } }
    const { container } = render(<ToolCallCard item={item} {...actions} />)
    expand()
    expect(screen.getByText('Answer')).toBeTruthy()
    expect(screen.getByText('42')).toBeTruthy()
    expect(container.querySelector('img, iframe, script')).toBeNull()
  })

  it.each([
    ['SpawnAgent', { name: 'Reviewer', task: 'Review the patch' }, 'Reviewer'],
    ['SendMessage', { to: '#design', text: 'Please review' }, '#design'],
    ['OpenRoom', { name: 'design', purpose: 'Review the patch' }, 'design'],
    ['TaskUpdate', { id: 7, status: 'in_progress' }, '#7'],
    ['Skill', { name: 'guide' }, 'guide'],
    ['ExperienceQuery', { query: 'fix flaky tests' }, 'fix flaky tests'],
    ['ScheduleCreate', { spec: 'daily at 09:00', text: 'Review tests' }, 'daily at 09:00'],
    ['Wake', { after: '5m', note: 'Check completion' }, '5m']
  ])('shows semantic identity for %s', (name, input, target) => {
    render(<ToolCallCard item={fixture(name, input, 'Recorded response')} {...actions} />)
    expect(screen.getByText(target)).toBeTruthy()
    expand()
    expect(screen.getByText('Recorded response')).toBeTruthy()
  })

  it('shows failure from isError and respects interrupted/pending states', () => {
    const item = fixture('WebSearch', { query: 'bingo' }, 'Network unavailable')
    item.body.output!.isError = true
    const { rerender } = render(<ToolCallCard item={item} {...actions} />)
    expect(screen.getByText('Failed')).toBeTruthy()
    rerender(<ToolCallCard item={{ ...item, status: 'interrupted' }} {...actions} />)
    expect(screen.getByText('Interrupted')).toBeTruthy()
    rerender(<ToolCallCard item={{ ...item, status: 'pending', body: { ...item.body, output: undefined } }} {...actions} />)
    expect(screen.getByText('Pending')).toBeTruthy()
  })

  it('bounds deeply nested and wide JSON without reserializing a deep value', () => {
    const deep = '['.repeat(10000) + '0' + ']'.repeat(10000)
    const { container, rerender } = render(<ToolCallCard item={fixture('mcp__test__deep', {}, deep)} {...actions} />)
    expand()
    expect(container.querySelector('.tool-recorded-text pre')).toBeNull()
    fireEvent.click(screen.getByText('Inspect recorded content'))
    fireEvent(container.querySelector('.tool-structured-fallback details')!, new Event('toggle'))
    expect(container.querySelector('.tool-recorded-text pre')?.textContent).toBe(deep)
    const wide = JSON.stringify(Array.from({ length: 100 }, () => Array.from({ length: 100 }, () => 0)))
    rerender(<ToolCallCard item={fixture('mcp__test__deep', {}, wide)} {...actions} />)
    expect(container.querySelectorAll('.tool-result-fields').length).toBe(0)
    expect(container.querySelector('.tool-recorded-text pre')?.textContent).toBe(wide)
  })

  it('collapses huge MCP JSON without parsing it and preserves exact copy and bounded inspection', async () => {
    const text = JSON.stringify({ records: [{ source: 'x'.repeat(100000) }] })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { container } = render(<ToolCallCard item={fixture('mcp__report__large', {}, text)} {...actions} />)
    expand()
    expect(container.querySelector('.tool-recorded-text pre')).toBeNull()
    expect(screen.getByText('Structured content is summarized for display. Expand a bounded preview or copy the complete recorded text.')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy recorded output' })))
    expect(writeText).toHaveBeenCalledWith(text)
    fireEvent.click(screen.getByText('Inspect recorded content'))
    fireEvent(container.querySelector('.tool-structured-fallback details')!, new Event('toggle'))
    expect(container.querySelector('.tool-recorded-text pre')?.textContent).toBe(text.slice(0, 64000))
    expect(screen.getByText('Preview limited to 64000 characters. Copy preserves the recorded text.')).toBeTruthy()
    expect(container.querySelector('.tool-diagnostics pre')).toBeNull()
  })

  it('keeps raw diagnostics lazy and limits large output rendering', () => {
    const huge = 'x'.repeat(100000)
    const { container } = render(<ToolCallCard item={fixture('mcp__test__large', { body: huge }, huge)} {...actions} />)
    expand()
    expect(container.querySelector('.tool-diagnostics pre')).toBeNull()
    expect(container.querySelector('.tool-recorded-text pre')?.textContent?.length).toBe(64000)
    expect(screen.getByText('Preview limited to 64000 characters. Copy preserves the recorded text.')).toBeTruthy()
  })

  it('renders task listing statuses as recorded rows, not input state', () => {
    render(<ToolCallCard item={fixture('TaskList', {}, '#3 [in_progress] write the plan — reviewer (blocked by #1)\n#4 [pending] check the patch')} {...actions} />)
    expand()
    expect(screen.getByText('#3')).toBeTruthy()
    expect(screen.getByText('in_progress')).toBeTruthy()
    expect(screen.getByText('write the plan — reviewer (blocked by #1)')).toBeTruthy()
  })

  it('uses a direct child receipt ID for navigation and never another thread name', () => {
    const item = fixture('SpawnAgent', { name: 'Reviewer' }, '{"name":"Reviewer","session":"child"}')
    const onSelectSession = vi.fn()
    const sessions = [{ id: 'child', cwd: '/tmp', createdAt: '', updatedAt: '', parent: { session: 'root' } }]
    const { rerender } = render(<ToolCallCard item={item} {...actions} sessionId="root" sessions={sessions} onSelectSession={onSelectSession} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }))
    expect(onSelectSession).toHaveBeenCalledWith('child')
    rerender(<ToolCallCard item={item} {...actions} sessionId="other-root" sessions={sessions} onSelectSession={onSelectSession} />)
    expect(screen.queryByRole('button', { name: 'Open conversation' })).toBeNull()
  })

  it('shows canonical question labels and display responses', () => {
    const item = fixture('AskUserQuestion', { questions: [{ header: 'Database', question: 'Which database?', options: [{ label: 'SQLite' }] }] })
    item.body.output!.display = { kind: 'keyValue', rows: [['Database', 'SQLite']] }
    render(<ToolCallCard item={item} {...actions} />)
    expand()
    expect(screen.getByText('Which database?')).toBeTruthy()
    expect(screen.getByText('SQLite')).toBeTruthy()
  })

  it('keeps ShowPage HTML inert and does not auto-open any link', () => {
    const { container } = render(<ToolCallCard item={fixture('ShowPage', { title: 'Choose a layout', html: '<script>fetch("https://evil")</script>' }, '{"layout":"A"}')} {...actions} />)
    expand()
    expect(container.querySelector('script, iframe, img')).toBeNull()
    expect(screen.getByText('layout')).toBeTruthy()
    expect(actions.openLink).not.toHaveBeenCalled()
  })

  it('shows image-only MCP results without claiming empty content and explains omitted media', () => {
    const item = fixture('mcp__report__image', {})
    item.body.output = { parts: [{ type: 'image', mediaType: 'image/png', data: 'aGVsbG8=' }, { type: 'image', mediaType: 'image/svg+xml', data: 'PHN2Zz4=' }] }
    render(<ToolCallCard item={item} {...actions} />)
    expand()
    expect(screen.getByRole('img').getAttribute('src')).toBe('data:image/png;base64,aGVsbG8=')
    expect(screen.queryByText('Empty recorded content.')).toBeNull()
    expect(screen.getByText('Some recorded images cannot be previewed safely. See the raw result.')).toBeTruthy()
  })

  it.each(['[]', '{}', 'false', '0', 'null', '""'])('retains empty and falsy MCP JSON: %s', (text) => {
    render(<ToolCallCard item={fixture('mcp__report__value', {}, text)} {...actions} />)
    expand()
    expect(screen.getByText(text)).toBeTruthy()
    expect(screen.queryByText('No result recorded yet.')).toBeNull()
  })

  it('renders homogeneous MCP records as a bounded table and only explicit safe links', () => {
    const text = JSON.stringify([{ name: 'a', url: 'https://example.com/a' }, { name: 'b', url: 'javascript:evil()' }, { name: 'c', url: 'file:///etc/passwd' }])
    const { container } = render(<ToolCallCard item={fixture('mcp__report__rows', {}, text)} {...actions} />)
    expand()
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByText('javascript:evil()').tagName).toBe('SPAN')
    expect(screen.getByText('file:///etc/passwd').tagName).toBe('SPAN')
    expect(actions.openLink).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'https://example.com/a' }))
    expect(actions.openLink).toHaveBeenCalledWith('https://example.com/a')
    expect(container.querySelector('iframe,script,img')).toBeNull()
    expect(screen.getByRole('button', { name: /^Hide tool details:/ }).getAttribute('aria-expanded')).toBe('true')
  })

  it('toggles when the tool icon is clicked and leaves independent actions outside the button', () => {
    const { container } = render(<ToolCallCard item={fixture('WebFetch', { url: 'https://example.com/docs' }, 'Documentation')} {...actions} />)
    const row = screen.getByRole('button', { name: /^Show tool details: WebFetch/ })
    expect(row.getAttribute('aria-controls')).toBeTruthy()
    fireEvent.click(row.querySelector('svg')!)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Open link' }))
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('button button, .tool-card-disclosure')).toBeNull()
  })

  it('offers HTTP links by explicit user action only', () => {
    render(<ToolCallCard item={fixture('WebFetch', { url: 'https://example.com/docs' }, 'Documentation')} {...actions} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open link' }))
    expect(actions.openLink).toHaveBeenCalledWith('https://example.com/docs')
  })
})
