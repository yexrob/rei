import { describe, expect, it, vi } from 'vitest'
const languages = vi.hoisted(() => ({ preferred: ['en-US'] as string[] }))
vi.mock('electron', () => ({ app: { getPreferredSystemLanguages: () => languages.preferred, getLocale: () => 'en-US' } }))
import { localeFor, systemLocale, text } from './locale'

describe('native dialog localization', () => {
  it('follows the first preferred system language like the renderer default', () => {
    expect(localeFor(['zh-Hans-CN', 'en-US'])).toBe('zh-CN')
    expect(localeFor(['zh_TW'])).toBe('zh-CN')
    expect(localeFor(['en-US', 'zh-CN'])).toBe('en')
    expect(localeFor(['zu'])).toBe('en')
    expect(localeFor([])).toBe('en')
  })
  it('keeps English source text unchanged, including the E2E teardown quit prompt', () => {
    languages.preferred = ['en-GB']
    expect(systemLocale()).toBe('en')
    expect(text('Quit Rei and stop running work?')).toBe('Quit Rei and stop running work?')
    expect(text('Add provider “{name}”?', { name: 'Local' })).toBe('Add provider “Local”?')
  })
  it('translates dialog strings for a Chinese system and falls back for unknown ones', () => {
    languages.preferred = ['zh-CN']
    expect(text('Delete conversation?')).toBe('删除对话？')
    expect(text('Add provider “{name}”?', { name: 'Local' })).toBe('添加提供商“Local”？')
    expect(text('Untranslated dialog')).toBe('Untranslated dialog')
    expect(text('Quit', undefined, 'en')).toBe('Quit')
  })
})
