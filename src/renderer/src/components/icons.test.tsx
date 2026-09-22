// @vitest-environment jsdom
import { createRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as icons from './icons'
import { readFileSync } from 'node:fs'

const css = readFileSync('src/renderer/src/components/icons.css', 'utf8')

afterEach(cleanup)

const names = [
  'AlarmClock', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowUpRight', 'Asterisk', 'AtSign',
  'Blocks', 'BookOpen', 'Bot', 'Brain', 'CalendarClock', 'Check', 'CheckCircle', 'ChevronDown', 'ChevronRight',
  'ChevronUp', 'CircleHelp', 'CirclePause', 'Clock3', 'Copy', 'Cpu', 'Diamond', 'Download', 'ExternalLink',
  'FileCode2', 'FileImage', 'FileSearch', 'FileText', 'Flower2', 'Folder', 'FolderOpen', 'GitCompareArrows',
  'Globe', 'Globe2', 'Hash', 'Info', 'Keyboard', 'KeyRound', 'Laptop', 'Layers', 'Lightbulb', 'ListTodo',
  'LoaderCircle', 'MessageSquare', 'MessagesSquare', 'Monitor', 'Moon', 'MoreHorizontal', 'Orbit', 'Palette',
  'PanelLeft', 'PanelRight', 'PanelsTopLeft', 'Pin', 'Plug', 'Plus', 'RefreshCw', 'ReiMark', 'RotateCw',
  'Search', 'Settings2', 'Shield', 'ShieldCheck', 'SlidersHorizontal', 'Sparkles', 'Square', 'SquarePen',
  'SquareTerminal', 'Sun', 'Terminal', 'TerminalSquare', 'Trash2', 'TriangleAlert', 'Wrench', 'X'
] as const

describe('Rei icon contract', () => {
  it.each(names)('%s uses the optical grid and stays decorative by default', (name) => {
    const Icon = icons[name]
    const { container } = render(<Icon size={16} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(svg.getAttribute('width')).toBe('16')
    expect(svg.getAttribute('height')).toBe('16')
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.getAttribute('stroke-width')).toBe('1.7')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('focusable')).toBe('false')
    expect(svg.classList.contains('rei-icon')).toBe(true)
    expect(svg.getAttribute('data-icon')).toBeTruthy()
    expect(svg.querySelector('path, circle, rect, ellipse')).not.toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('supports named standalone graphics and explicit decorative use', () => {
    const { rerender } = render(<icons.ReiMark title="Rei workspace" />)
    expect(screen.getByRole('img', { name: 'Rei workspace' })).toBeTruthy()
    rerender(<icons.ReiMark aria-label="Workspace" />)
    expect(screen.getByRole('img', { name: 'Workspace' })).toBeTruthy()
    rerender(<><span id="icon-label">Connected</span><icons.Plug aria-labelledby="icon-label" /></>)
    expect(screen.getByRole('img', { name: 'Connected' })).toBeTruthy()
    rerender(<icons.ReiMark title="Rei workspace" aria-hidden="true" />)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('preserves SVG styling, events, children and refs without losing base identity', () => {
    const ref = createRef<SVGSVGElement>()
    const onClick = vi.fn()
    const { container } = render(<icons.Plus ref={ref} size="1em" width={20} className="custom-icon" strokeWidth={2} onClick={onClick}><desc>Create a new item</desc></icons.Plus>)
    const svg = container.querySelector('svg')!
    expect(ref.current).toBe(svg)
    expect(svg.getAttribute('width')).toBe('20')
    expect(svg.getAttribute('height')).toBe('1em')
    expect(svg.getAttribute('stroke-width')).toBe('2')
    expect(svg.classList.contains('custom-icon')).toBe(true)
    expect(svg.querySelector('desc')?.textContent).toBe('Create a new item')
    fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('does not add an extra accessible name to labelled buttons', () => {
    render(<button aria-label="Add project"><icons.Plus /></button>)
    expect(screen.getByRole('button', { name: 'Add project' })).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('keeps motion finite and declares reduced-motion and forced-colors fallbacks', () => {
    expect(css).not.toMatch(/infinite/)
    expect(css).toContain('prefers-reduced-motion: reduce')
    expect(css).toContain('animation: none !important')
    expect(css).toContain('forced-colors: active')
    expect(css).toContain(':focus-visible')
    expect(css).toContain(':not(:disabled)')
  })
})
