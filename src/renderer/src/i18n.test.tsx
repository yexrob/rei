// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef, type ReactNode } from 'react'
import type { Interaction, Item, View } from '../../shared/rpc'
import { I18nProvider, translate, useI18n } from './i18n'
import { zhCN } from './locales/zh-CN'
import { CodeBlock, RichText, StructuredView } from './components/Content'
import { InteractionPanel } from './components/InteractionPanel'
import { ProviderSetup } from './components/ProviderSetup'
import { Timeline } from './components/Timeline'
import { Settings, Onboarding } from './components/Settings'
import { Composer } from './components/Composer'
import { ModelPicker } from './components/Picker'
import { StartupTransition } from './components/StartupTransition'
import { CopyButton, ErrorBanner } from './components/primitives'
import { rustInitial } from './state/fixtures'
import { createSessionProjection } from './state/session'
import type { useWorkspace } from './state/useWorkspace'

function LanguageControls(): React.JSX.Element {
  const { t, locale, preference, setLocale } = useI18n()
  return <><output data-testid="locale">{locale}</output><output data-testid="preference">{preference}</output><h1>{t('Settings')}</h1><button onClick={() => setLocale('en')}>English</button><button onClick={() => setLocale('zh-CN')}>简体中文</button><button onClick={() => setLocale('system')}>System</button></>
}
function localized(children: ReactNode) { return render(<I18nProvider><LanguageControls />{children}</I18nProvider>) }
function systemLanguage(value: string) { vi.spyOn(navigator, 'language', 'get').mockReturnValue(value) }
function item(id: string, body: Item['body'], status: Item['status'] = 'completed'): Item { return { id, body, status, startedAt: '2026-09-05T10:00:00Z' } }
function interaction(kind: Interaction['kind'], answers: Interaction['answers']): Interaction { return { id: 'interaction', session: 'session', openedAt: '2026-09-05T10:00:00Z', kind, answers } }
const noAction = () => {}

beforeEach(() => {
  localStorage.clear(); systemLanguage('en-US')
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('UI translation function', () => {
  it('uses English source keys and leaves unknown strings intact', () => {
    expect(translate('Settings', 'en')).toBe('Settings')
    expect(translate('Settings', 'zh-CN')).toBe('设置')
    expect(translate('An extension-owned label', 'zh-CN')).toBe('An extension-owned label')
    expect(translate('constructor', 'zh-CN')).toBe('constructor')
  })
  it('interpolates both locales without translating or recursively expanding variable values', () => {
    expect(translate('Sign in to {provider}', 'zh-CN', { provider: 'Settings/{count}' })).toBe('登录 Settings/{count}')
    expect(translate('Exit {code}', 'en', { code: 0 })).toBe('Exit 0')
    expect(translate('Retrying · attempt {attempt} of {max}', 'zh-CN', { attempt: 2, max: 5 })).toBe('正在重试 · 第 2 次，共 5 次')
    expect(translate('{missing} {count} {count}', 'zh-CN', { count: 3 })).toBe('{missing} 3 3')
  })
  it('keeps every catalog interpolation token in its translation', () => {
    const tokens = (text: string) => [...text.matchAll(/\{\w+\}/g)].map(([token]) => token).sort()
    for (const [source, translated] of Object.entries(zhCN)) expect(tokens(translated), source).toEqual(tokens(source))
  })
})

describe('language preference', () => {
  it.each(['zh', 'zh-CN', 'zh-TW', 'zh-Hans'])('maps system %s to Simplified Chinese without saving a preference', (language) => {
    systemLanguage(language)
    localized(null)
    expect(screen.getByRole('heading', { name: '设置' })).toBeTruthy()
    expect(screen.getByTestId('preference').textContent).toBe('system')
    expect(document.documentElement.lang).toBe('zh-CN')
    expect(localStorage.getItem('rei.locale')).toBeNull()
  })
  it('falls back to English for unsupported system languages and stale preferences', () => {
    systemLanguage('fr-FR'); localStorage.setItem('rei.locale', 'fr')
    localized(null)
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByTestId('locale').textContent).toBe('en')
    expect(screen.getByTestId('preference').textContent).toBe('system')
  })
  it('persists an explicit choice only in rei.locale and restores it on remount', () => {
    localStorage.setItem('rei.drafts.v1', '{"draft":"Settings"}')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const first = localized(null)
    fireEvent.click(screen.getByRole('button', { name: '简体中文' }))
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(setItem).toHaveBeenCalledWith('rei.locale', 'zh-CN')
    expect(localStorage.getItem('rei.drafts.v1')).toBe('{"draft":"Settings"}')
    first.unmount(); localized(null)
    expect(screen.getByRole('heading', { name: '设置' })).toBeTruthy()
    expect(screen.getByTestId('preference').textContent).toBe('zh-CN')
  })
  it('tracks languagechange only when following the system, and can return to it', () => {
    localized(null)
    act(() => { systemLanguage('zh-CN'); window.dispatchEvent(new Event('languagechange')) })
    expect(screen.getByTestId('locale').textContent).toBe('zh-CN')
    fireEvent.click(screen.getByRole('button', { name: 'English' }))
    act(() => { systemLanguage('zh-TW'); window.dispatchEvent(new Event('languagechange')) })
    expect(screen.getByTestId('locale').textContent).toBe('en')
    fireEvent.click(screen.getByRole('button', { name: 'System' }))
    expect(screen.getByTestId('locale').textContent).toBe('zh-CN')
    expect(localStorage.getItem('rei.locale')).toBe('system')
  })
  it('still switches in memory when localStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    localized(null)
    fireEvent.click(screen.getByRole('button', { name: '简体中文' }))
    expect(screen.getByRole('heading', { name: '设置' })).toBeTruthy()
  })
  it('removes its system listener and restores the document language on unmount', () => {
    const original = document.documentElement.lang
    const remove = vi.spyOn(window, 'removeEventListener')
    const view = localized(null)
    view.unmount()
    expect(remove).toHaveBeenCalledWith('languagechange', expect.any(Function))
    expect(document.documentElement.lang).toBe(original)
  })
})

describe('localized renderer boundaries', () => {
  it('updates memoized transcript controls without translating user, model, reasoning, tool, or shell content', () => {
    const projection = createSessionProjection({ ...rustInitial, items: [
      item('user', { kind: 'user', parts: [{ type: 'text', text: 'Cancel' }], origin: { surface: 'desktop' } }),
      item('assistant', { kind: 'assistant', text: 'Ready' }),
      item('reasoning', { kind: 'reasoning', text: 'Thinking' }),
      item('tool', { kind: 'toolCall', name: 'Settings', callId: 'call', input: { path: '/work/Settings' }, progress: 'Working…', output: { parts: [{ type: 'text', text: 'Failed' }] } }),
      item('shell', { kind: 'shell', command: 'echo Ready', output: 'Done', exit: 7, cwd: '/work/Settings' })
    ] })
    const { container } = localized(<Timeline projection={projection} openLink={noAction} runAction={noAction} loadHistory={noAction} loading={false} />)
    expect(screen.getByRole('button', { name: 'Copy response' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '简体中文' }))
    expect(screen.getByRole('button', { name: '复制回复' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '加载更早的消息' })).toBeTruthy()
    expect(container.querySelector('.user-prose')?.textContent).toBe('Cancel')
    expect(container.querySelector('.assistant-message .markdown')?.textContent).toBe('Ready')
    expect(container.querySelector('.reasoning-content')?.textContent).toBe('Thinking')
    expect(container.querySelector('.tool-name')?.textContent).toBe('Settings')
    expect(container.querySelector('.tool-target')?.textContent).toBe('/work/Settings')
    expect(container.querySelector('.live-tail')?.textContent).toBe('Working…')
    expect(container.querySelector('.tool-output')?.textContent).toBe('Failed')
    expect(screen.getByText('退出码 7')).toBeTruthy()
    expect([...container.querySelectorAll('pre code')].map((node) => node.textContent)).toContain('$ echo Ready\nDone')
  })
  it('translates image guidance and copy controls, not Markdown alt text, code languages or code', () => {
    localStorage.setItem('rei.locale', 'zh-CN')
    const { container } = localized(<><RichText text={'![Settings](https://example.com/image.png)\n\n```Ready\nCancel\n```'} openLink={noAction} /><CodeBlock text="Save name" /></>)
    expect(screen.getByText('图片：Settings · 不会自动加载')).toBeTruthy()
    expect(screen.getByText('Ready')).toBeTruthy()
    expect(screen.getByText('Cancel')).toBeTruthy()
    expect(screen.getByText('Save name')).toBeTruthy()
    expect(screen.getByText('纯文本')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '复制代码' })).toHaveLength(2)
    expect(container.querySelector('img')).toBeNull()
  })
  it('leaves all structured remote labels and action identifiers untouched', () => {
    localStorage.setItem('rei.locale', 'zh-CN')
    const action = vi.fn()
    const view: View = { kind: 'stack', children: [
      { kind: 'panel', title: 'Model', child: { kind: 'text', text: 'Provider' } },
      { kind: 'progress', label: 'Progress', value: 1, total: 2 },
      { kind: 'actions', items: [{ label: 'Cancel', action: { name: 'Settings' } }] },
      { kind: 'progress', value: 0, total: 1 }
    ] }
    localized(<StructuredView view={view} runAction={action} openLink={noAction} />)
    expect(screen.getByRole('heading', { name: 'Model' })).toBeTruthy()
    expect(screen.getByText('Provider')).toBeTruthy()
    expect(screen.getByText('Progress')).toBeTruthy()
    expect(screen.getByText('进度')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(action).toHaveBeenCalledWith({ name: 'Settings' })
  })
  it('localizes permission controls while preserving scope, preview, and answer protocol', async () => {
    localStorage.setItem('rei.locale', 'zh-CN')
    const respond = vi.fn(async () => {})
    localized(<InteractionPanel interaction={interaction({ kind: 'permission', tool: 'Settings', summary: 'Ready', sessionScope: 'Edit(/work/Settings)', preview: { kind: 'command', cwd: '/work/Settings', command: 'echo Cancel' } }, ['deny', 'allowOnce', 'allowSession'])} respond={respond} openLink={noAction} />)
    expect(screen.getByRole('heading', { name: '需要授权' })).toBeTruthy()
    expect(screen.getByText('Settings')).toBeTruthy()
    expect(screen.getByText('Edit(/work/Settings)')).toBeTruthy()
    expect(screen.getByText('echo Cancel')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '允许本次会话' }))
    await waitFor(() => expect(respond).toHaveBeenCalledWith({ kind: 'allowSession', scope: 'Edit(/work/Settings)' }, 'keyboard'))
  })
  it('does not translate remote questions/options or submitted free text', async () => {
    localStorage.setItem('rei.locale', 'zh-CN')
    const respond = vi.fn(async () => {})
    localized(<InteractionPanel interaction={interaction({ kind: 'question', question: 'Provider', options: [{ id: 'cancel', label: 'Cancel', description: 'Settings' }], multi: false, freeText: true }, ['text', 'choice', 'cancel'])} respond={respond} openLink={noAction} />)
    expect(screen.getByRole('radio', { name: 'CancelSettings' })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: '你的回答' }), { target: { value: 'Ready' } })
    fireEvent.click(screen.getByRole('button', { name: '提交回答' }))
    await waitFor(() => expect(respond).toHaveBeenCalledWith({ kind: 'text', text: 'Ready' }, 'keyboard'))
  })
  it('preserves remote error detail, even when it matches a known UI key', async () => {
    localStorage.setItem('rei.locale', 'zh-CN')
    localized(<InteractionPanel interaction={interaction({ kind: 'confirm', title: 'Cancel', detail: 'Settings' }, ['confirm'])} respond={async () => { throw new Error('Ready') }} openLink={noAction} />)
    expect(screen.getByRole('heading', { name: 'Cancel' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Ready')
  })
  it('translates paste-login guidance without sending secrets or changing the provider identity', () => {
    localStorage.setItem('rei.locale', 'zh-CN')
    localized(<InteractionPanel interaction={interaction({ kind: 'login', provider: 'Settings', flow: { kind: 'paste' } }, ['text', 'cancel'])} respond={vi.fn()} openLink={noAction} />)
    expect(screen.getByRole('heading', { name: '登录 Settings' })).toBeTruthy()
    expect(screen.getByText('bingo login Settings paste')).toBeTruthy()
    expect(screen.getByText(/为保障安全，粘贴的凭据不会通过对话发送/)).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy()
  })
  it('keeps the custom provider picker and preserves a remote configure error', async () => {
    localStorage.setItem('rei.locale', 'zh-CN')
    const configureProvider = vi.fn(async () => ({ ok: false, error: { code: 'REMOTE', message: 'Settings: endpoint refused' } }))
    vi.stubGlobal('bingoDesktop', { configureProvider })
    const workspace = { connection: { workspace: '/work' }, setNotice: vi.fn() } as unknown as ReturnType<typeof useWorkspace>
    const { container } = localized(<ProviderSetup workspace={workspace} onDone={vi.fn()} />)
    expect(screen.getByRole('combobox', { name: 'API 协议' }).tagName).toBe('BUTTON')
    expect(container.querySelector('select:not([aria-hidden="true"])')).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: '提供商名称' }), { target: { value: 'Settings' } })
    fireEvent.click(screen.getByRole('button', { name: '保存提供商' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Settings: endpoint refused')
    expect(configureProvider).toHaveBeenCalledWith({ name: 'Settings', protocol: 'openai', baseUrl: '', apiKey: '' })
  })
})

function settingsWorkspace() {
  return {
    connection: { status: 'ready', workspace: '/work', binary: '/bin/bingo' },
    preferences: { theme: 'light', recentWorkspaces: [] }, catalogs: {},
    readCatalog: vi.fn(async () => {}), report: vi.fn(), savePreferences: vi.fn(async () => {}), connect: vi.fn(async () => {})
  } as unknown as ReturnType<typeof useWorkspace>
}
async function selectOption(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('option', { name: option }))
}

describe('localized settings and desktop controls', () => {
  it('switches through the actual Settings custom picker without writing bingo preferences', async () => {
    const workspace = settingsWorkspace()
    render(<I18nProvider><Settings workspace={workspace} onClose={noAction} openLink={noAction} clearDrafts={noAction} /></I18nProvider>)
    expect(screen.getByRole('combobox', { name: 'Language' }).tagName).toBe('BUTTON')
    await selectOption('Language', '简体中文')
    expect(screen.getByRole('dialog', { name: '设置' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '关闭对话框' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '外观' })).toBeTruthy()
    expect(localStorage.getItem('rei.locale')).toBe('zh-CN')
    expect(workspace.savePreferences).not.toHaveBeenCalled()
    await selectOption('语言', 'English')
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()
    expect(localStorage.getItem('rei.locale')).toBe('en')
  })
  it('localizes model-picker controls without changing provider/model labels or selection IDs', async () => {
    localStorage.setItem('rei.locale', 'zh-CN')
    const select = vi.fn()
    localized(<ModelPicker value="Settings/Ready" models={[{ id: 'Settings/Ready', label: 'Ready', meta: { provider: 'Settings', reasoning: true } }]} onValueChange={select} />)
    const trigger = screen.getByRole('button', { name: '模型' })
    expect(trigger.textContent).toBe('Ready')
    expect(trigger.getAttribute('title')).toBe('Settings/Ready')
    fireEvent.click(trigger)
    expect(await screen.findByRole('combobox', { name: '搜索模型' })).toBeTruthy()
    expect(screen.getByText('Settings')).toBeTruthy()
    fireEvent.click(screen.getByRole('option', { name: /^Ready\s*推理$/ }))
    expect(select).toHaveBeenCalledWith('Settings/Ready')
  })
  it('localizes composer choices and queue status while keeping command and draft values unchanged', async () => {
    localStorage.setItem('rei.locale', 'zh-CN')
    const command = vi.fn()
    localized(<Composer draft={{ text: 'Settings', images: [] }} setDraft={vi.fn()} send={noAction} stop={noAction} attach={noAction} ready busy={false} sending={false} model="Settings/Ready" thinking="high" permission="plan" models={[]} command={command} commands={[]} inputRef={createRef()} queue={[{ intent: 'req', position: 0, preview: 'Cancel', steerable: true, origin: { surface: 'desktop' } }]} />)
    expect((screen.getByRole('textbox', { name: '向 bingo 发送消息' }) as HTMLTextAreaElement).value).toBe('Settings')
    expect(screen.getByText('1 条消息排队中')).toBeTruthy()
    expect(screen.getByText('Cancel')).toBeTruthy()
    expect(screen.getByRole('button', { name: '发送消息' })).toBeTruthy()
    await selectOption('思考强度', '极高')
    expect(command).toHaveBeenCalledWith('think', 'xhigh')
    await selectOption('权限模式', '跳过权限提示')
    expect(command).toHaveBeenCalledWith('permission', 'bypassPermissions')
  })
  it('translates clipboard feedback, but not copied text or error details', async () => {
    localStorage.setItem('rei.locale', 'zh-CN')
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    localized(<><CopyButton text="Ready" /><ErrorBanner message="Settings" onRetry={noAction} onDismiss={noAction} /></>)
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    expect(await screen.findByRole('button', { name: '已复制' })).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith('Ready')
    expect(screen.getByRole('alert').textContent).toBe('Settings重试')
    expect(screen.getByRole('button', { name: '关闭错误提示' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'English' }))
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
  })
  it('localizes startup and optional-workspace onboarding without changing their behavior', () => {
    localStorage.setItem('rei.locale', 'zh-CN')
    const workspace = settingsWorkspace()
    const { container } = localized(<StartupTransition ready={false}><Onboarding workspace={workspace} openLink={noAction} /></StartupTransition>)
    expect(screen.getByText('正在打开你的空间')).toBeTruthy()
    expect(container.querySelector('.startup-stage')?.getAttribute('data-phase')).toBe('intro')
    fireEvent.click(screen.getByRole('button', { name: '跳过开场' }))
    expect(container.querySelector('.startup-stage')?.getAttribute('data-phase')).toBe('settled')
    expect(screen.getByRole('heading', { name: '连接 bingo' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '选择可执行文件' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重新连接' }))
    expect(workspace.connect).toHaveBeenCalledWith(undefined)
  })
})
