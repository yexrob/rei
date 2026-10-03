import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { zhCN } from './locales/zh-CN'

const root = 'src/renderer/src'
// Brand, protocol and purely technical labels that intentionally stay in English.
const ALLOWLIST = new Set<string>(['Rei', 'bingo', 'Bingo', 'MCP', 'URL', 'JSON', 'Git', 'SSH', 'HTTP', 'HTTPS'])

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/fixtures?\.tsx?$/.test(name) && !path.includes(`${join(root, 'locales')}`) ? [path] : []
  })
}

function literals(source: string): string[] {
  const found: string[] = []
  // t('…') / t("…") with a plain literal first argument (no template interpolation).
  for (const match of source.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*[,)]/g)) found.push(match[2])
  // t(cond ? '…' : '…') — both branches are UI keys.
  for (const match of source.matchAll(/\bt\(\s*[^'"()?]+\?\s*(['"])((?:\\.|(?!\1).)*)\1\s*:\s*(['"])((?:\\.|(?!\3).)*)\3\s*[,)]/g)) found.push(match[2], match[4])
  // <IconButton label="…"> string literals are translated inside IconButton.
  for (const match of source.matchAll(/<IconButton\b[^>]*?\blabel="([^"]+)"/g)) found.push(match[1])
  return found.map(text => text.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n'))
}

describe('zh-CN catalog coverage', () => {
  it('translates every literal UI key used by the renderer', () => {
    const missing: string[] = []
    for (const file of sources(root)) {
      for (const key of literals(readFileSync(file, 'utf8'))) {
        if (!key.trim() || ALLOWLIST.has(key) || Object.hasOwn(zhCN, key)) continue
        missing.push(`${relative(root, file)}: ${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('finds the keys it is meant to scan', () => {
    expect(literals(`t('Unread'); t("Rooms", { a }); t(open ? 'Collapse' : 'Expand'); <IconButton label="Hide sidebar" />`)).toEqual(['Unread', 'Rooms', 'Collapse', 'Expand', 'Hide sidebar'])
  })
})
