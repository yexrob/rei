// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RichText } from './components/Content'

afterEach(cleanup)

describe('safe Markdown rendering', () => {
  it('renders Markdown while preventing raw HTML and dangerous links', () => {
    const markdown = '# Heading\n\n- item\n\n**bold** `code`\n\n```js\nconst safe = true\n```\n\n<script>window.__pwned = true</script>\n<img src=x onerror="window.__pwned = true">\n[jump](javascript:window.__pwned=true)'
    const { container } = render(<RichText text={markdown} openLink={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeTruthy()
    expect(screen.getByText('item')).toBeTruthy()
    expect(screen.getByText('bold')).toBeTruthy()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('a')?.getAttribute('href') ?? null).toBeNull()
    expect((window as typeof window & { __pwned?: boolean }).__pwned).not.toBe(true)
  })

  it('routes only web links through the desktop callback without loading images', () => {
    const openLink = vi.fn()
    const { container } = render(<RichText text={'[docs](https://example.org/docs)\n\n![tracking pixel](https://evil.test/pixel.png)\n\n[local](file:///etc/passwd)\n\n<img src="https://evil.test/raw.png">\n<iframe src="https://evil.test"></iframe>'} openLink={openLink} />)
    fireEvent.click(screen.getByRole('link', { name: 'docs' }))
    expect(openLink).toHaveBeenCalledExactlyOnceWith('https://example.org/docs')
    expect([...container.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual(['https://example.org/docs'])
    expect(container.querySelector('img,iframe,video,audio,script,object,embed')).toBeNull()
    expect(screen.getByText(/not loaded automatically/)).toBeTruthy()
  })

  it('copies exact diagram source without an executable HTML frame', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { container } = render(<RichText text={'```mermaid\ngraph TD; A-->B\n```'} openLink={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith('graph TD; A-->B\n'))
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('appends partial tokens into one response and finishes an open fence cleanly', () => {
    const openLink = vi.fn()
    const { container, rerender } = render(<RichText text={'Hello **wor'} final={false} openLink={openLink} />)
    expect(container.textContent).toContain('Hello')
    rerender(<RichText text={'Hello **world**\n\n```ts\nconst ans'} final={false} openLink={openLink} />)
    expect(container.querySelector('strong')?.textContent).toBe('world')
    rerender(<RichText text={'Hello **world**\n\n```ts\nconst answer = 42\n```'} final openLink={openLink} />)
    expect(container.querySelectorAll('strong')).toHaveLength(1)
    expect(container.querySelectorAll('pre')).toHaveLength(1)
    expect(container.querySelector('pre')?.textContent).toBe('const answer = 42\n')
  })

  it('renders tables and task lists without interactive controls', () => {
    const { container } = render(<RichText text={'| Name | Value |\n| --- | --- |\n| Ready | yes |\n\n- [x] Done\n- [ ] Waiting'} openLink={vi.fn()} />)
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'yes' })).toBeTruthy()
    expect(container.querySelectorAll('input:not([disabled])')).toHaveLength(0)
  })
})
