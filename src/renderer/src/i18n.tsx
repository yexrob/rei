import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { zhCN } from './locales/zh-CN'

export type Locale = 'en' | 'zh-CN'
export type LocalePreference = 'system' | Locale
export type UiString = keyof typeof zhCN
export type TranslationVariables = Record<string, string | number>
export type Translator = (source: string, vars?: TranslationVariables) => string

const storageKey = 'rei.locale'

// Translate only UI-owned source strings, never model output or protocol data.
export function translate(source: string, locale: Locale, vars?: TranslationVariables): string {
  const text = locale === 'zh-CN' && Object.hasOwn(zhCN, source) ? zhCN[source as UiString] : source
  return vars ? text.replace(/\{(\w+)\}/g, (placeholder, key: string) => Object.hasOwn(vars, key) ? String(vars[key]) : placeholder) : text
}

function systemLocale(): Locale {
  return typeof navigator !== 'undefined' && /^zh(?:-|$)/i.test(navigator.language) ? 'zh-CN' : 'en'
}

function savedPreference(): LocalePreference {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved === 'en' || saved === 'zh-CN') return saved
  } catch { /* UI language remains usable when storage is unavailable. */ }
  return 'system'
}

type I18n = { t: Translator; locale: Locale; preference: LocalePreference; setLocale: (preference: LocalePreference) => void }
const I18nContext = createContext<I18n>({ t: (source, vars) => translate(source, 'en', vars), locale: 'en', preference: 'system', setLocale: () => {} })

export function I18nProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [preference, setPreference] = useState(savedPreference)
  const [system, setSystem] = useState(systemLocale)
  const locale = preference === 'system' ? system : preference
  const setLocale = useCallback((next: LocalePreference) => {
    setPreference(next)
    try { localStorage.setItem(storageKey, next) } catch { /* Keep the selection for this window. */ }
  }, [])
  useEffect(() => {
    const update = () => setSystem(systemLocale())
    window.addEventListener('languagechange', update)
    return () => window.removeEventListener('languagechange', update)
  }, [])
  useEffect(() => {
    const previous = document.documentElement.lang
    document.documentElement.lang = locale
    return () => { document.documentElement.lang = previous }
  }, [locale])
  const value = useMemo<I18n>(() => ({ t: (source, vars) => translate(source, locale, vars), locale, preference, setLocale }), [locale, preference, setLocale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n { return useContext(I18nContext) }
