import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/renderer/src/styles.css', 'utf8')
const settings = readFileSync('src/renderer/src/components/settings.css', 'utf8')

function declarations(source: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...source.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]+)\\}`, 'g'))]
  expect(matches, `expected exactly one ${selector} rule`).toHaveLength(1)
  return Object.fromEntries(matches[0][1].split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const colon = part.indexOf(':')
    return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()]
  }))
}

// Frozen from 84c03ac. These are the existing product colors, not a new palette.
const originalLight = {
  '--canvas': '#fafaf9', '--sidebar': '#f0f0ee', '--surface': '#ffffff', '--hover': '#ededea', '--selected': '#e5e5e2',
  '--text': '#242424', '--secondary': '#666661', '--quiet': '#666661', '--line': '#e2e2df', '--control-line': '#b6b6b1',
  '--accent': '#242424', '--on-accent': '#ffffff', '--focus': '#3665a4', '--danger': '#a75050', '--danger-bg': '#f8ebe9',
  '--warning': '#896025', '--warning-bg': '#faf4e8', '--success': '#34764f', '--addition-bg': '#eaf4ec', '--code': '#f0f0ee',
  '--shadow': '0 12px 48px #252b231c, 0 2px 8px #252b230c'
}
const originalDark = {
  '--canvas': '#202020', '--sidebar': '#191919', '--surface': '#262626', '--hover': '#2b2b2b', '--selected': '#303030',
  '--text': '#ededed', '--secondary': '#a5a5a0', '--quiet': '#9a9a95', '--line': '#393939', '--control-line': '#70706b',
  '--accent': '#ededed', '--on-accent': '#202020', '--focus': '#9ac3ff', '--danger': '#e39494', '--danger-bg': '#3a2929',
  '--warning': '#e4c989', '--warning-bg': '#393326', '--success': '#82c99a', '--addition-bg': '#24372a', '--code': '#191919',
  '--shadow': '0 12px 48px #0005, 0 2px 8px #0003'
}

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/../g)!.map((channel) => parseInt(channel, 16) / 255)
    .map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
}

describe('original neutral palette contract', () => {
  for (const [selector, original] of [[':root', originalLight], [':root[data-theme="dark"]', originalDark]] as const) {
    it(`${selector} preserves the original backgrounds, foregrounds and semantic colors`, () => {
      expect(declarations(css, selector)).toMatchObject(original)
    })
    it(`${selector} never makes quiet text louder than secondary`, () => {
      const tokens = declarations(css, selector)
      // Light theme has no AA headroom on selected rows, so quiet may equal secondary there.
      const contrast = (fg: string) => { const a = luminance(tokens[fg]), b = luminance(tokens['--canvas']); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }
      expect(contrast('--quiet')).toBeLessThanOrEqual(contrast('--secondary'))
      expect(tokens['--deletion-bg']).toMatch(/^#[0-9a-f]{6}$/)
    })
    it(`${selector} maps new surfaces onto neutral product tokens`, () => {
      expect(declarations(css, selector)).toMatchObject({
        '--surface-raised': 'var(--surface)', '--surface-inset': 'var(--code)', '--brand-soft': 'var(--selected)'
      })
    })
    it(`${selector} keeps quiet and secondary labels readable on every neutral surface`, () => {
      const tokens = declarations(css, selector)
      // Matches the desktop contrast audit: quiet captions can sit on hover and selected rows too.
      for (const foreground of ['--secondary', '--quiet']) {
        for (const background of ['--canvas', '--sidebar', '--surface', '--hover', '--selected', '--code']) {
          const a = luminance(tokens[foreground]), b = luminance(tokens[background])
          expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    })
  }

  it('selects a session with the original grey fill, not an accent border or side strip', () => {
    expect(declarations(css, '.session-row')).toMatchObject({ border: '0', background: 'transparent' })
    const selected = declarations(css, '.session-row.selected')
    expect(selected).toEqual({ background: 'var(--selected)', color: 'var(--text)', 'font-weight': '550' })
    const sessionRules = [...css.matchAll(/([^{}]*\.session-row[^{}]*)\{([^{}]*)\}/g)]
    for (const [_, selector, body] of sessionRules) {
      expect(body).not.toContain('var(--brand)')
      expect(body).not.toMatch(/box-shadow:\s*inset/)
      expect(selector).not.toMatch(/::before|::after/)
    }
  })

  it('keeps New thread as a plain navigation item and primary actions neutral', () => {
    expect(declarations(css, '.sidebar-actions .new-thread-button')).toEqual({ 'font-weight': '600' })
    expect(css).not.toMatch(/\.new-thread-button:hover\s*\{/)
    expect(declarations(css, '.sidebar-actions button, .sidebar-bottom > button')).toMatchObject({ background: 'transparent', 'border-color': 'transparent' })
    expect(declarations(css, 'button.primary, .primary')).toMatchObject({ background: 'var(--accent)', color: 'var(--on-accent)', 'border-color': 'var(--accent)' })
    expect(declarations(css, '.send-button:hover:not(:disabled), .stop-button:hover:not(:disabled)')).toMatchObject({ background: 'var(--accent)' })
    expect(css).not.toMatch(/background(?:-color)?:[^;\n]*var\(--brand\)/)
  })

  it('keeps enabled sidebar shortcut labels opaque instead of diluting neutral text', () => {
    expect(declarations(css, 'kbd').color).toBe('var(--secondary)')
    for (const selector of ['.sidebar-actions kbd', '.sidebar-actions .new-thread-button', '.sidebar-actions', '.sidebar']) {
      expect(Number(declarations(css, selector).opacity ?? '1'), `${selector} opacity`).toBe(1)
    }
  })

  it('shows neutral light and dark workspace miniatures', () => {
    expect(declarations(settings, '.theme-preview')).toMatchObject({ '--preview-bg': originalLight['--canvas'], '--preview-rail': originalLight['--sidebar'], '--preview-ink': originalLight['--secondary'] })
    expect(declarations(settings, '.theme-preview-dark')).toMatchObject({ '--preview-bg': originalDark['--canvas'], '--preview-rail': originalDark['--sidebar'], '--preview-ink': originalDark['--secondary'] })
    expect(declarations(settings, '.theme-preview-system')).toMatchObject({ '--preview-bg': 'linear-gradient(90deg, #fafaf9 50%, #202020 50%)', '--preview-rail': originalLight['--sidebar'] })
  })

  it('retains actual focus, high-contrast selection and reduced-motion affordances', () => {
    expect(declarations(css, ':focus-visible')).toEqual({ outline: '2px solid var(--focus)', 'outline-offset': '3px' })
    expect(css).toContain('@media (forced-colors: active)')
    expect(css).toContain('.session-row.selected, .sidebar-actions .selected { outline: 2px solid Highlight;')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('animation: none !important; transition: none !important;')
  })
})
