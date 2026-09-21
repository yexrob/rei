// @vitest-environment jsdom
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContentPart, Item } from '../../../shared/rpc'
import { RichText } from './Content'
import { JournalMediaProvider, collectJournalMedia, recordedImageSource, useRecordedImage } from './media/JournalMedia'
import { sanitizeDiagramSvg, diagramSourceAllowed, renderDiagram } from './media/diagram'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const image: ContentPart = { type: 'image', path: '/tmp/a picture.png', mediaType: 'image/png', data: png }
const recorded = (parts: ContentPart[]): Item => ({ id: 'image', status: 'completed', startedAt: '', body: { kind: 'user', parts, origin: { surface: 'desktop' } } })
afterEach(cleanup)

describe('journal-only Markdown media', () => {
  it('resolves exact recorded paths including nested tool results and encoded spaces, never filesystem URLs', () => {
    const items = [recorded([{ type: 'toolResult', toolUseId: 'x', parts: [image] }])]
    expect(collectJournalMedia(items).get('/tmp/a picture.png')).toBe(`data:image/png;base64,${png}`)
    const { container } = render(<JournalMediaProvider items={items}><RichText text={'![record](</tmp/a picture.png>)\n\n![same](/tmp/a%20picture.png)\n\n![missing](/etc/unknown.png)\n\n![file](file:///etc/private.png)'} openLink={vi.fn()} /></JournalMediaProvider>)
    expect(container.querySelectorAll('img')).toHaveLength(2)
    expect(screen.getByRole('img', { name: 'record' }).getAttribute('src')).toBe(`data:image/png;base64,${png}`)
    expect(container.querySelector('[src^="file:"]')).toBeNull()
  })
  it('resolves raw Windows drive paths after Markdown encodes backslashes and spaces', () => {
    const path = String.raw`C:\Users\runner\media-project\recorded picture.png`
    const items = [recorded([{ ...image, path }])]
    const markdown = `![raw](<${path}>)\n\n![spaces](<${path.replaceAll(' ', '%20')}>)\n\n![encoded](<${encodeURIComponent(path)}>)`
    const { container } = render(<JournalMediaProvider items={items}><RichText text={markdown} openLink={vi.fn()} /></JournalMediaProvider>)
    expect(container.querySelectorAll('img')).toHaveLength(3)
    for (const name of ['raw', 'spaces', 'encoded']) expect(screen.getByRole('img', { name }).getAttribute('src')).toBe(`data:image/png;base64,${png}`)
  })
  it.each(['file:///tmp/private.png', 'http://example.test/image.png', 'https://example.test/image.png', '//example.test/image.png', 'data:image/png;base64,AAAA', 'C:relative.png'].flatMap(path => [path, encodeURIComponent(path)]))('rejects URL or drive-relative journal identities even when recorded: %s', (path) => {
    const items = [recorded([{ ...image, path }, { ...image, path: decodeURIComponent(path) }])]
    const { result } = renderHook(() => useRecordedImage(path), { wrapper: ({ children }) => <JournalMediaProvider items={items}>{children}</JournalMediaProvider> })
    expect(result.current).toBeUndefined()
  })
  it('keeps failed URI decoding literal and never resolves an unrecorded path', () => {
    const path = '/tmp/100% complete.png'
    const items = [recorded([{ ...image, path }, { ...image, path: 'file:///tmp/%ZZ.png' }])]
    const { result, rerender } = renderHook(({ path }) => useRecordedImage(path), { initialProps: { path }, wrapper: ({ children }) => <JournalMediaProvider items={items}>{children}</JournalMediaProvider> })
    expect(result.current).toBe(`data:image/png;base64,${png}`)
    rerender({ path: '/tmp/missing%ZZ.png' })
    expect(result.current).toBeUndefined()
    rerender({ path: 'file:///tmp/%ZZ.png' })
    expect(result.current).toBeUndefined()
  })
  it('rejects SVG, malformed base64, oversized images and deep nested parts', () => {
    expect(recordedImageSource({ mediaType: 'image/svg+xml', data: png })).toBeUndefined()
    expect(recordedImageSource({ mediaType: 'image/png', data: '<script>' })).toBeUndefined()
    expect(recordedImageSource({ mediaType: 'image/png', data: 'a'.repeat(7_000_001) })).toBeUndefined()
    let part: ContentPart = image
    for (let i = 0; i < 20; i++) part = { type: 'toolResult', toolUseId: 'x', parts: [part] }
    expect(collectJournalMedia([recorded([part])]).size).toBe(0)
  })
  it('requires a deliberate click for remote images, strips referrers and credentials, and resets consent on URL changes', () => {
    const { container, rerender } = render(<RichText text={'![remote](https://example.org/a.png)'} openLink={vi.fn()} />)
    expect(container.querySelector('img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Load external image' }))
    const img = screen.getByRole('img', { name: 'remote' })
    expect(img.getAttribute('crossorigin')).toBe('anonymous')
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer')
    fireEvent.error(img)
    expect(screen.getByText(/Image could not be loaded/)).toBeTruthy()
    rerender(<RichText text={'![remote](https://example.org/b.png)'} openLink={vi.fn()} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByRole('button', { name: 'Load external image' })).toBeTruthy()
    expect(screen.queryByText(/Image could not be loaded/)).toBeNull()
    rerender(<RichText text={'![remote](https://user:password@example.org/a.png)'} openLink={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Load external image' })).toBeNull()
  })
})

describe('generated math and diagrams', () => {
  it('renders real inline/display KaTeX with untrusted commands disabled', () => {
    const { container } = render(<RichText text={'Inline $x^2$\n\n$$\n\\frac{a}{b}\n$$\n\n$\\href{https://evil.test}{click}$\n\n$\\includegraphics{https://evil.test/image.png}$'} openLink={vi.fn()} />)
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2)
    expect(container.querySelector('.katex-display')).not.toBeNull()
    expect(container.querySelector('a,img,iframe,script')).toBeNull()
  })
  it('keeps incomplete math and mermaid fences as source', () => {
    const { container } = render(<RichText text={'$x^\n\n```mermaid\ngraph TD; A-->B'} final={false} openLink={vi.fn()} />)
    expect(container.querySelector('.katex')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('graph TD; A-->B')
  })
  it('renders two real Mermaid diagrams with isolated unique SVG ids and retains source', async () => {
    // jsdom does not implement SVG layout; the renderer itself is real.
    Object.defineProperty(SVGElement.prototype, 'getBBox', { configurable: true, value: () => ({ x: 0, y: 0, width: 120, height: 30 }) })
    Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', { configurable: true, value: () => 80 })
    expect(await renderDiagram('graph TD; A-->B')).toContain('<svg')
    const { container } = render(<RichText text={'```mermaid\ngraph TD; A-->B\n```\n\n```mermaid\nsequenceDiagram\nAlice->>Bob: Hello\n```'} openLink={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('img', { name: 'Mermaid diagram' })).toHaveLength(2), { timeout: 15000 })
    const sources = [...container.querySelectorAll('img')].map((img) => decodeURIComponent(img.src.split(',')[1]))
    expect(sources.every((svg) => svg.includes('<svg') && !/foreignObject|<script|onclick|<a\s/.test(svg))).toBe(true)
    expect(sources.every((svg) => /<style>[^<]+/.test(svg))).toBe(true)
    expect(sources[0]).toMatch(/fill:\s*#ECECFF/i)
    const ids = sources.map((svg) => new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement.id)
    expect(ids.every((id) => id.startsWith('rei-diagram-'))).toBe(true)
    expect(new Set(ids).size).toBe(2)
    expect(sources[0]).not.toBe(sources[1])
    expect(screen.getAllByRole('button', { name: 'Copy code' })).toHaveLength(2)
  })
  it('preserves generated text positioning while rejecting active SVG attributes', () => {
    const svg = sanitizeDiagramSvg('<svg xmlns="http://www.w3.org/2000/svg"><text><tspan dx="0" dy="1.1em" onclick="alert(1)">Label</tspan></text></svg>')
    expect(svg).toContain('dx="0"')
    expect(svg).toContain('dy="1.1em"')
    expect(svg).not.toContain('onclick')
  })
  it('rejects source configuration, HTML, image references and unsafe SVG output', () => {
    for (const source of ['%%{init: {securityLevel:"loose"}}%%\ngraph TD; A-->B', '---\nconfig: {}\n---\ngraph TD', 'graph TD\nA["<img src=x>"]', 'graph TD\nA@{ img: "https://evil.test/x" }', 'graph TD\nclick A "https://evil.test"']) expect(diagramSourceAllowed(source)).toBe(false)
    const safe = sanitizeDiagramSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><foreignObject><div>bad</div></foreignObject><a href="https://evil.test"><text>link</text></a><image href="x"/><rect onclick="alert(1)" style="fill:url(https://evil.test)"/><text>safe</text></svg>')
    expect(safe).not.toMatch(/script|foreignObject|href|onclick|https:|<image|<a\s/)
    expect(safe).toContain('safe')
  })
})
